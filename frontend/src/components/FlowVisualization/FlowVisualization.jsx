import React, { useRef, useEffect } from 'react';

export function FlowVisualization({ components, results }) {
  const canvasRef = useRef(null);
  // Spostato al livello superiore per rispettare le regole degli Hooks
  const particles = useRef([]);

  useEffect(() => {
    if (!results || !results.data || !canvasRef.current) return;

    const { x, mach, pressure, temperature } = results.data;
    
    // GUARDIA: previene crash e calcoli NaN se i dati sono incompleti o vuoti
    if (!x || x.length === 0 || !pressure || pressure.length === 0 || !temperature) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    // Assicura che totalL non sia mai 0 o undefined per evitare divisioni per zero
    const totalL = (x[x.length - 1] > 0) ? x[x.length - 1] : 1;
    const maxP = Math.max(...pressure);
    const minP = Math.min(...pressure);
    const maxT = Math.max(...temperature);
    const minT = Math.min(...temperature);

    let maxRadius = 0.01;
    components.forEach(c => {
      const r_in = (c.params.d_in || c.params.d_h || 0.1) / 2;
      const r_out = (c.params.d_out || c.params.d_h || 0.1) / 2;
      maxRadius = Math.max(maxRadius, r_in, r_out);
    });

    const numParticles = 1000;
    
    // Reset delle particelle se la lunghezza non coincide o la struttura è vecchia
    if (!particles.current || particles.current.length !== numParticles || !particles.current[0].history) {
      particles.current = [];
      for (let i = 0; i < numParticles; i++) {
        particles.current.push({
          x: Math.random() * totalL,
          yOffset: (Math.random() - 0.5) * 1.8, 
          history: [] 
        });
      }
    }

    const interpolate = (val, xArr, yArr) => {
      // Controllo aggiuntivo per yArr mancante o vuoto
      if (!xArr || xArr.length === 0 || !yArr || yArr.length === 0) return 0;
      if (isNaN(val)) return yArr[0] || 0;
      if (val <= xArr[0]) return yArr[0];
      if (val >= xArr[xArr.length - 1]) return yArr[yArr.length - 1];
      let i = 0;
      while (i < xArr.length - 1 && xArr[i+1] < val) i++;
      const t = (val - xArr[i]) / (xArr[i+1] - xArr[i]);
      const res = yArr[i] + (isNaN(t) ? 0 : t) * (yArr[i+1] - yArr[i]);
      return isNaN(res) ? 0 : res;
    };

    const getDuctRadius = (val) => {
      let currentX = 0;
      for (const comp of components) {
        const L = comp.params.length || 0;
        if (val >= currentX && val <= currentX + L) {
          const d_in = comp.params.d_in || comp.params.d_h || 0.1;
          const d_out = comp.params.d_out || comp.params.d_h || 0.1;
          const frac = L > 0 ? (val - currentX) / L : 0;
          return (d_in + (d_out - d_in) * frac) / 2;
        }
        currentX += L;
      }
      return maxRadius;
    };

    const getColorForTemp = (temp, alpha = 0.25) => {
      if (isNaN(temp) || temp === undefined) return `rgba(59, 130, 246, ${alpha})`; 
      
      const t = Math.max(0, Math.min(1, (temp - minT) / (maxT - minT + 1e-6)));
      
      // Multi-stop gradient: Blue -> Cyan -> Green -> Yellow -> Red
      let r, g, b;
      if (t < 0.25) { // Blue to Cyan
        const f = t / 0.25;
        r = 30; g = Math.round(50 + f * 150); b = 255;
      } else if (t < 0.5) { // Cyan to Green
        const f = (t - 0.25) / 0.25;
        r = Math.round(30 + f * 70); g = 200; b = Math.round(255 - f * 200);
      } else if (t < 0.75) { // Green to Yellow
        const f = (t - 0.5) / 0.25;
        r = Math.round(100 + f * 155); g = Math.round(200 + f * 55); b = 55;
      } else { // Yellow to Red
        const f = (t - 0.75) / 0.25;
        r = 255; g = Math.round(255 - f * 200); b = Math.round(55 - f * 20);
      }
      
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    // Detect shock locations
    const shocks = [];
    for (let i = 0; i < mach.length - 1; i++) {
      // Look for abrupt jump from supersonic to subsonic
      if (mach[i] > 1.01 && mach[i+1] < 0.99) {
        shocks.push({ x: x[i], m1: mach[i], m2: mach[i+1] });
      }
    }

    const updateCanvasSize = () => {
      const container = canvas.parentElement;
      if (container) {
        canvas.width = container.clientWidth;
        canvas.height = 250; 
      }
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      const marginX = 60;
      const marginY = 40;
      const drawW = w - 2 * marginX;
      const drawH = h - 2 * marginY;

      ctx.clearRect(0, 0, w, h);

      const yScale = (drawH / 2) / (maxRadius || 0.1);

      // 1. Draw Duct Background with Flow Gradient
      const steps = 120;
      for (let i = 0; i < steps; i++) {
        const x1 = (i / steps) * totalL;
        const x2 = ((i + 1) / steps) * totalL;
        const t_local = interpolate(x1, x, temperature);
        const m = interpolate(x1, x, mach);
        const r1 = getDuctRadius(x1);
        const r2 = getDuctRadius(x2);

        const px1 = marginX + (x1 / totalL) * drawW;
        const px2 = marginX + (x2 / totalL) * drawW;
        const py1_t = h / 2 - r1 * yScale;
        const py1_b = h / 2 + r1 * yScale;
        const py2_t = h / 2 - r2 * yScale;
        const py2_b = h / 2 + r2 * yScale;

        ctx.fillStyle = getColorForTemp(t_local, 0.3);
        ctx.beginPath();
        ctx.moveTo(px1, py1_t); ctx.lineTo(px2, py2_t);
        ctx.lineTo(px2, py2_b); ctx.lineTo(px1, py1_b);
        ctx.fill();

        // Mach lines in supersonic flow
        if (m > 1.1 && i % 8 === 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.08)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px1, py1_t); ctx.lineTo(px1 + 15, py1_b);
          ctx.stroke();
        }
      }

      // 2. Draw Shockwaves Indicators
      shocks.forEach(shock => {
        const sx = marginX + (shock.x / totalL) * drawW;
        const r = getDuctRadius(shock.x);
        const yTop = h / 2 - r * yScale;
        const yBottom = h / 2 + r * yScale;

        // Glowing line
        const grad = ctx.createLinearGradient(sx - 5, 0, sx + 5, 0);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.8)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        ctx.fillStyle = grad;
        ctx.fillRect(sx - 3, yTop, 6, yBottom - yTop);

        // Core sharp line
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(sx, yTop);
        ctx.lineTo(sx, yBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#fff';
        ctx.fillText('NORMAL SHOCK', sx, yTop - 15);
        ctx.shadowBlur = 0;
        
        ctx.font = '8px Inter, sans-serif';
        ctx.fillText(`M: ${shock.m1.toFixed(2)} \u2192 ${shock.m2.toFixed(2)}`, sx, yTop - 5);
      });

      // 3. Draw Particles
      particles.current.forEach(p => {
        const t_local = interpolate(p.x, x, temperature);
        const m = interpolate(p.x, x, mach);
        const p_local = interpolate(p.x, x, pressure);
        const r = getDuctRadius(p.x);

        // Shock interaction: dramatic jump in properties
        let inShock = false;
        shocks.forEach(s => {
          if (Math.abs(p.x - s.x) < 0.01) {
            inShock = true;
            p.yOffset += (Math.random() - 0.5) * 0.15; // Increased turbulence
          }
        });

        // Dynamic velocity based on Mach number - CLAMPED to avoid visual skipping
        const maxStep = totalL * 0.02; // Max 2% of duct length per frame
        const velocity = Math.min(maxStep, 0.001 + (m * 0.008));
        p.x += velocity;

        if (p.x > totalL) {
          p.x = 0;
          p.history = [];
          p.yOffset = (Math.random() - 0.5) * 1.8;
        }

        // Density representation: higher pressure = more opaque and slightly larger
        const p_norm = (p_local - minP) / (maxP - minP + 1e-6);
        const alpha = Math.min(1.0, 0.3 + p_norm * 0.7);
        
        const px = marginX + (p.x / totalL) * drawW;
        const py = h / 2 + p.yOffset * r * yScale;

        // Trail effect
        p.history.push({ x: px, y: py });
        if (p.history.length > 4) p.history.shift();

        if (p.history.length > 1) {
          ctx.beginPath();
          ctx.moveTo(p.history[0].x, p.history[0].y);
          for (let k = 1; k < p.history.length; k++) {
            ctx.lineTo(p.history[k].x, p.history[k].y);
          }
          ctx.strokeStyle = getColorForTemp(t_local, alpha * 0.4);
          ctx.lineWidth = Math.max(0.5, 1 + p_norm * 2);
          ctx.stroke();
        }

        // Particle core
        ctx.fillStyle = inShock ? '#fff' : `rgba(255, 255, 255, ${alpha})`;
        if (inShock) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#fff';
        }
        ctx.beginPath();
        const size = (m > 1) ? 1 : (1.5 + p_norm); // Subsonic particles (compressed) look slightly larger
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // 4. Draw Outer Walls
      const drawWall = (isBottom) => {
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const xv = (i/steps) * totalL;
          const rv = getDuctRadius(xv);
          const px = marginX + (xv/totalL) * drawW;
          const py = h / 2 + (isBottom ? 1 : -1) * (rv * yScale);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const xv = (i/steps) * totalL;
          const rv = getDuctRadius(xv);
          const px = marginX + (xv/totalL) * drawW;
          const py = h / 2 + (isBottom ? 1 : -1) * (rv * yScale - (isBottom ? 2 : -2));
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();
      };

      drawWall(false);
      drawWall(true);

      // 5. Draw Component Divisions and Labels
      let currentDivX = 0;
      ctx.setLineDash([4, 4]);
      components.forEach((comp, idx) => {
        const L = comp.params.length || 0;
        
        if (L > 0) {
          const startX = currentDivX;
          const midX = currentDivX + L / 2;
          
          const pxStart = marginX + (startX / totalL) * drawW;
          const pxMid = marginX + (midX / totalL) * drawW;
          
          // Draw dividing line at the start of component (skip first)
          if (idx > 0) {
            ctx.beginPath();
            ctx.moveTo(pxStart, marginY / 2);
            ctx.lineTo(pxStart, h - marginY / 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }

          // Draw label
          ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.font = '600 9px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(comp.type.toUpperCase().replace('_', ' '), pxMid, marginY - 10);
        }
        
        currentDivX += L;
      });
      ctx.setLineDash([]);

      animationFrameId = requestAnimationFrame(render);
    };

    render();
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, [results, components]);

  return (
    <div className="glass-card animate-fade-in" style={{ marginTop: '2rem', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)' }}>
      <div style={{ padding: '0.75rem 1.25rem', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          🌊 Dynamic Flow Simulation
        </span>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: 80, height: 8, borderRadius: 4, background: 'linear-gradient(90deg, #1e32ff, #1ec8ff, #64c837, #ffff37, #ff3723)' }}></div>
            Temperature (Cold → Hot)
          </span>
        </div>
      </div>
      <canvas 
        ref={canvasRef} 
        height={250} 
        style={{ 
          width: '100%', 
          height: 'auto', 
          display: 'block', 
          background: '#0f172a',
          backgroundImage: 'radial-gradient(circle at center, #1e293b 0%, #0f172a 100%), linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 20px 20px, 20px 20px'
        }}
      />
      <div style={{ padding: '0.6rem 1.25rem', fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid rgba(255,255,255,0.05)', letterSpacing: '0.05em' }}>
        <span style={{ fontWeight: 700 }}>INLET</span>
        <span style={{ fontStyle: 'italic', opacity: 0.6 }}>VELOCITY FIELD - COLOR $\propto$ TEMP - DENSITY $\propto$ PRESSURE</span>
        <span style={{ fontWeight: 700 }}>EXIT</span>
      </div>
    </div>
  );
}
