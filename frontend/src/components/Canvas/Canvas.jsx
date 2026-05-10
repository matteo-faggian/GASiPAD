import React from 'react';
import { FlowVisualization } from '../FlowVisualization/FlowVisualization';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import { ComponentBlock } from '../ComponentBlock/ComponentBlock';

export function Canvas({ components, setComponents, config, results }) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setComponents((items) => {
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const updateComponent = (id, newComp) => {
    setComponents(comps => comps.map(c => c.id === id ? newComp : c));
  };

  const removeComponent = (id) => {
    setComponents(comps => comps.filter(c => c.id !== id));
  };

  return (
    <div className="canvas-area">
      <div className="canvas-wrapper">
        <div className="canvas-grid-layout">
          
          {/* LEFT COLUMN: Pipeline */}
          <div className="pipeline-column" style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
            {/* Reservoir box */}
            <div className="boundary-box">
              <span style={{ fontSize: '1.5rem' }}>🔵</span>
              <div>
                <div className="label">Reservoir</div>
                <div style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                  P₀ = {Number(config.P0).toLocaleString()} Pa &nbsp;|&nbsp;
                  T₀ = {config.T0} K
                </div>
              </div>
            </div>

            {/* Arrow down */}
            <div className="boundary-arrow">↓</div>

            {/* Pipeline */}
            <div className={`pipeline-container ${components.length > 0 ? 'active' : ''}`}>
              <div className="pipeline-header">
                <h3>🔩 Pipeline Assembly</h3>
                <span className="pipeline-badge">
                  {components.length} component{components.length !== 1 ? 's' : ''}
                  &nbsp;— drag to reorder
                </span>
              </div>

              {components.length === 0 ? (
                <div className="empty-state">
                  <div style={{ fontSize: '3rem', opacity: 0.3 }}>🛠️</div>
                  <h3 style={{ color: 'var(--text-muted)' }}>Pipeline Empty</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    Click a component in the left panel to add it here.
                  </p>
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={components.map(c => c.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {components.map((comp, index) => (
                      <React.Fragment key={comp.id}>
                        {index > 0 && (
                          <div className="flow-connector">↓ flow</div>
                        )}
                        <ComponentBlock
                          id={comp.id}
                          component={comp}
                          index={index}
                          onUpdate={updateComponent}
                          onRemove={removeComponent}
                        />
                      </React.Fragment>
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>

            {/* Arrow down to exit */}
            <div className="boundary-arrow">↓</div>

            {/* Exit box */}
            <div className="boundary-box">
              <span style={{ fontSize: '1.5rem' }}>🟡</span>
              <div>
                <div className="label">Ambient Exit</div>
                <div style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                  Pₐ = {Number(config.P_amb).toLocaleString()} Pa
                </div>
              </div>
            </div>
            
            {/* Dynamic Flow Visualization */}
            {results && results.data && (
              <div style={{ marginTop: '2rem' }}>
                <FlowVisualization components={components} results={results} />
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Summary Panel */}
          <div className="summary-column" style={{ position: 'sticky', top: '0' }}>
            {results && results.summary && (
              <div className="summary-panel" style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
                boxShadow: 'var(--shadow-md)'
              }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>🚀</span> Performance
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {Object.entries(results.summary).map(([key, data]) => (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{key}</span>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ color: 'var(--accent-primary)', fontWeight: 600, fontFamily: 'monospace', fontSize: '1.05rem' }}>
                          {Number(data.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.25rem' }}>{data.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
