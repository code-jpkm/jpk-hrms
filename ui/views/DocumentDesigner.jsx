import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { api, patch, post, remove } from '../api/client.js';
import { ErrorBox } from '../components/Ui.jsx';

const PAGE = { A4: [595.28, 841.89], LETTER: [612, 792], LEGAL: [612, 1008] };

const PALETTE = [
  { kind: 'HEADING', label: 'Heading', icon: 'FileText', w: 515, h: 28, defaults: { text: 'DOCUMENT TITLE', fontSize: 15, bold: true, align: 'center' } },
  { kind: 'TEXT', label: 'Paragraph', icon: 'StickyNote', w: 515, h: 60, defaults: { text: 'Type your text here. Insert live data with the token picker.', fontSize: 10.5, align: 'justify' } },
  { kind: 'FIELD_GRID', label: 'Field list', icon: 'ListChecks', w: 250, h: 92, defaults: { fontSize: 10, fields: [{ label: 'Employee', value: '{{employee.fullName}}' }, { label: 'Code', value: '{{employee.code}}' }] } },
  { kind: 'EARNINGS_TABLE', label: 'Earnings table', icon: 'Wallet', w: 515, h: 260, defaults: { fontSize: 9.5, borderColor: '#1F3445' } },
  { kind: 'TABLE', label: 'Table', icon: 'Grid3x3', w: 515, h: 90, defaults: { fontSize: 10, rows: [['Particulars', 'Amount'], ['Item one', '0.00']], background: '#1F3445', borderColor: '#e5e7eb', borderWidth: 0.5 } },
  { kind: 'IMAGE', label: 'Logo / image', icon: 'Package', w: 120, h: 60, defaults: {} },
  { kind: 'DIVIDER', label: 'Divider', icon: 'Sliders', w: 515, h: 1, defaults: { borderColor: '#d1d5db', borderWidth: 1 } },
  { kind: 'SIGNATURE', label: 'Signature', icon: 'Pencil', w: 220, h: 52, defaults: { text: 'Authorised Signatory', fontSize: 9 } },
  { kind: 'SPACER', label: 'Spacer', icon: 'Maximize2', w: 515, h: 20, defaults: {} }
];

const uid = () => `blk_${Math.random().toString(36).slice(2, 9)}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ------------------------------------------------------------------ *
 * Canvas block — drag to move, corner handle to resize.
 * All geometry is stored in PDF points, so what you place is exactly
 * where it prints.
 * ------------------------------------------------------------------ */
function CanvasBlock({ block, scale, selected, onSelect, onChange }) {
  const drag = useRef(null);

  const onPointerDown = (e, mode) => {
    if (block.locked) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onSelect(block.id);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, x: block.x, y: block.y, w: block.w, h: block.h };
  };

  const onPointerMove = (e) => {
    if (!drag.current) return;
    const d = drag.current;
    const dx = (e.clientX - d.sx) / scale;
    const dy = (e.clientY - d.sy) / scale;
    if (d.mode === 'move') {
      onChange({ ...block, x: Math.round(d.x + dx), y: Math.round(d.y + dy) });
    } else {
      onChange({ ...block, w: Math.round(Math.max(24, d.w + dx)), h: Math.round(Math.max(8, d.h + dy)) });
    }
  };

  const onPointerUp = (e) => {
    if (drag.current) e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  const style = {
    position: 'absolute',
    left: block.x * scale,
    top: block.y * scale,
    width: block.w * scale,
    height: block.h * scale,
    fontSize: (block.fontSize || 11) * scale,
    color: block.color || '#1f2937',
    background: block.background || 'transparent',
    border: selected ? '1.5px solid #F38121' : (block.borderWidth ? `${block.borderWidth}px solid ${block.borderColor}` : '1px dashed rgba(120,120,150,.28)'),
    fontWeight: block.bold ? 700 : 400,
    fontStyle: block.italic ? 'italic' : 'normal',
    textAlign: block.align || 'left',
    cursor: block.locked ? 'not-allowed' : 'move',
    overflow: 'hidden',
    boxSizing: 'border-box',
    padding: (block.padding || 0) * scale,
    lineHeight: 1.35,
    userSelect: 'none',
    touchAction: 'none'
  };

  let inner = null;
  if (block.kind === 'DIVIDER') {
    inner = <div style={{ height: 0, borderTop: `${Math.max(1, block.borderWidth || 1) * scale}px solid ${block.borderColor || '#d1d5db'}` }} />;
  } else if (block.kind === 'FIELD_GRID') {
    inner = (block.fields || []).map((f, i) => (
      <div key={i} style={{ display: 'flex', gap: 6 }}>
        <span style={{ color: '#6b7280', flex: '0 0 42%' }}>{f.label}</span>
        <b style={{ minWidth: 0, overflow: 'hidden' }}>{f.value}</b>
      </div>
    ));
  } else if (block.kind === 'TABLE') {
    inner = (block.rows || []).map((r, ri) => (
      <div key={ri} style={{ display: 'flex', background: ri === 0 ? (block.background || '#1F3445') : 'transparent', color: ri === 0 ? '#fff' : 'inherit', fontWeight: ri === 0 ? 700 : 400 }}>
        {r.map((c, ci) => <span key={ci} style={{ flex: 1, padding: `${2 * scale}px ${4 * scale}px`, textAlign: ci ? 'right' : 'left' }}>{c}</span>)}
      </div>
    ));
  } else if (block.kind === 'EARNINGS_TABLE') {
    inner = (
      <div style={{ display: 'flex', height: '100%' }}>
        {['EARNINGS', 'DEDUCTIONS'].map((h) => (
          <div key={h} style={{ flex: 1 }}>
            <div style={{ background: block.borderColor || '#1F3445', color: '#fff', fontWeight: 700, padding: 3 * scale }}>{h}</div>
            <div style={{ padding: 4 * scale, color: '#9ca3af' }}>auto-filled from payroll</div>
          </div>
        ))}
      </div>
    );
  } else if (block.kind === 'IMAGE') {
    inner = block.imageDataUrl
      ? <img alt="" src={block.imageDataUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#9ca3af' }}>Image</div>;
  } else if (block.kind === 'SIGNATURE') {
    inner = <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ borderTop: '1px solid #9ca3af', width: '80%' }} />
      <span style={{ color: '#4b5563' }}>{block.text}</span>
    </div>;
  } else if (block.kind === 'SPACER') {
    inner = <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#c4c4d0' }}>spacer</div>;
  } else {
    inner = block.text;
  }

  return (
    <div
      style={style}
      onPointerDown={(e) => onPointerDown(e, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={(e) => { e.stopPropagation(); onSelect(block.id); }}
    >
      {inner}
      {selected && !block.locked && (
        <span
          onPointerDown={(e) => onPointerDown(e, 'resize')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ position: 'absolute', right: -6, bottom: -6, width: 13, height: 13, borderRadius: 3, background: '#F38121', border: '2px solid #fff', cursor: 'nwse-resize', touchAction: 'none' }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
export default function DocumentDesigner() {
  const [meta, setMeta] = useState({ types: [], tokens: [], blockKinds: [] });
  const [templates, setTemplates] = useState([]);
  const [doc, setDoc] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [scale, setScale] = useState(0.82);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [newType, setNewType] = useState('PAYSLIP');
  const [newName, setNewName] = useState('');
  const [startBlank, setStartBlank] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');

  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 3200); };

  const loadList = useCallback(async () => {
    try {
      const r = await api('/document-templates');
      setTemplates(r.templates || []);
    } catch (e) { setError(e); }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [m] = await Promise.all([api('/document-templates/types'), loadList()]);
        setMeta(m);
      } catch (e) { setError(e); }
    })();
  }, [loadList]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const selected = useMemo(() => doc?.blocks?.find((b) => b.id === selectedId) || null, [doc, selectedId]);
  const [pw, ph] = PAGE[doc?.pageSize || 'A4'];
  const pageW = doc?.orientation === 'landscape' ? ph : pw;
  const pageH = doc?.orientation === 'landscape' ? pw : ph;

  const patchBlock = (next) => setDoc((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === next.id ? next : b)) }));
  const setField = (key, value) => selected && patchBlock({ ...selected, [key]: value });

  const addBlock = (item) => {
    const b = { id: uid(), kind: item.kind, x: 40, y: 120, w: item.w, h: item.h, color: '#1f2937', align: 'left', fontSize: 11, ...item.defaults };
    setDoc((d) => ({ ...d, blocks: [...d.blocks, b] }));
    setSelectedId(b.id);
  };

  const removeBlock = () => {
    if (!selected) return;
    setDoc((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== selected.id) }));
    setSelectedId(null);
  };

  const duplicateBlock = () => {
    if (!selected) return;
    const copy = { ...selected, id: uid(), x: selected.x + 12, y: selected.y + 12 };
    setDoc((d) => ({ ...d, blocks: [...d.blocks, copy] }));
    setSelectedId(copy.id);
  };

  const insertToken = (token) => {
    if (!selected) return say('Select a block first, then click a token.');
    if (!('text' in selected) || ['IMAGE', 'DIVIDER', 'SPACER', 'EARNINGS_TABLE'].includes(selected.kind)) {
      return say(`${selected.kind} blocks do not take tokens.`);
    }
    patchBlock({ ...selected, text: `${selected.text || ''}{{${token}}}` });
  };

  const createTemplate = async () => {
    setBusy(true); setError(null);
    try {
      const r = await post('/document-templates', {
        type: newType,
        blank: startBlank,
        ...(newName.trim() ? { name: newName.trim() } : {})
      });
      await loadList();
      setDoc(r.template);
      setSelectedId(null);
      setNewName('');
      say(startBlank
        ? `Blank canvas created. Add blocks from the palette on the left.`
        : `Created "${r.template.name}" with a ready-made layout.`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const openTemplate = async (id) => {
    setBusy(true);
    try {
      const r = await api(`/document-templates/${id}`);
      setDoc(r.template); setSelectedId(null);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const save = async () => {
    if (!doc) return;
    setBusy(true); setError(null);
    try {
      const r = await patch(`/document-templates/${doc._id}`, {
        name: doc.name, description: doc.description, pageSize: doc.pageSize,
        orientation: doc.orientation, blocks: doc.blocks,
        watermarkText: doc.watermarkText, showPageNumbers: doc.showPageNumbers
      });
      setDoc(r.template); await loadList(); say('Saved.');
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const preview = async () => {
    if (!doc) return;
    if (!doc.blocks?.length) return say('Add at least one block before previewing.');
    setBusy(true); setError(null);
    try {
      // Posts the CURRENT unsaved layout, so the preview is what you see now.
      const blob = await api('/document-templates/preview', {
        method: 'POST',
        body: JSON.stringify({ template: doc }),
        toast: false
      });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      window.open(url, '_blank');
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const activate = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const r = await post(`/document-templates/${doc._id}/activate`, {});
      setDoc(r.template); await loadList(); say(r.message);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const removeTemplate = async () => {
    if (!doc || !window.confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await remove(`/document-templates/${doc._id}`);
      setDoc(null); await loadList(); say('Template deleted.');
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const uploadImage = (file) => {
    if (!file || !selected) return;
    const reader = new FileReader();
    reader.onload = () => patchBlock({ ...selected, imageDataUrl: reader.result });
    reader.readAsDataURL(file);
  };

  const grouped = useMemo(() => {
    const map = {};
    for (const t of templates) (map[t.type] ||= []).push(t);
    return map;
  }, [templates]);

  const typeLabel = (v) => meta.types.find((t) => t.value === v)?.label || v;

  return (
    <div className="nexus-page designer-page">
      <section className="premium-hero hero-strip page-intro">
        <div>
          <small className="section-kicker">DOCUMENT STUDIO</small>
          <h1 style={{ fontSize: 26, margin: '4px 0 4px' }}>Design any company document</h1>
          <p className="muted" style={{ margin: 0 }}>
            Design the company's payslip and letters (offer, joining, confirmation, experience and more).
            Mark a design live, then issue it to any employee from their profile.
          </p>
        </div>
      </section>

      <ErrorBox error={error} />
      {toast && <div className="toast-success">{toast}</div>}

      <div className="designer-shell">
        {/* ---------------- LEFT: templates + palette ---------------- */}
        <aside className="designer-rail">
          <div className="designer-panel">
            <b>New document</b>
            <select value={newType} onChange={(e) => setNewType(e.target.value)} style={{ marginBottom: 8 }}>
              {meta.types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input
              placeholder="Name (optional)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            <div className="start-mode">
              <button
                type="button"
                className={startBlank ? '' : 'is-on'}
                onClick={() => setStartBlank(false)}
              >
                <Icon name="Sparkles" size={16} />
                <b>Use a preset</b>
                <small>A finished layout you can edit</small>
              </button>
              <button
                type="button"
                className={startBlank ? 'is-on' : ''}
                onClick={() => setStartBlank(true)}
              >
                <Icon name="Plus" size={16} />
                <b>Start from scratch</b>
                <small>Empty page, build it yourself</small>
              </button>
            </div>
            <button className="primary" style={{ width: '100%', marginTop: 10 }} disabled={busy} onClick={createTemplate}>
              <Icon name="Plus" size={15} /> Create document
            </button>
          </div>

          <div className="designer-panel">
            <b>Your templates</b>
            <div className="designer-tpl-list">
              {!templates.length && <span className="muted small">Nothing yet — create one above.</span>}
              {Object.entries(grouped).map(([type, list]) => (
                <div key={type}>
                  <em>{typeLabel(type)}</em>
                  {list.map((t) => (
                    <button key={t._id} className={doc?._id === t._id ? 'active' : ''} onClick={() => openTemplate(t._id)}>
                      <span>{t.name}</span>
                      {t.active && <i>LIVE</i>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {doc && (
            <div className="designer-panel">
              <b>Add block</b>
              <div className="designer-palette">
                {PALETTE.map((p) => (
                  <button key={p.kind} onClick={() => addBlock(p)} title={`Add ${p.label}`}>
                    <Icon name={p.icon} size={15} />
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* ---------------- CENTRE: the page ---------------- */}
        <main className="designer-stage">
          {!doc ? (
            <div className="empty tall"><b>Pick a template on the left, or create one</b></div>
          ) : (
            <>
              <div className="designer-toolbar">
                <input value={doc.name} onChange={(e) => setDoc({ ...doc, name: e.target.value })} style={{ maxWidth: 260, fontWeight: 800 }} />
                <span className={`v25-status ${doc.active ? 'finalized' : 'draft'}`}>{doc.active ? 'LIVE' : 'DRAFT'}</span>
                <select value={doc.pageSize} onChange={(e) => setDoc({ ...doc, pageSize: e.target.value })} style={{ width: 92 }}>
                  {Object.keys(PAGE).map((s) => <option key={s}>{s}</option>)}
                </select>
                <select value={doc.orientation} onChange={(e) => setDoc({ ...doc, orientation: e.target.value })} style={{ width: 118 }}>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
                <label className="zoom-control">
                  <Icon name="Search" size={14} />
                  <input type="range" min="0.4" max="1.5" step="0.02" value={scale} onChange={(e) => setScale(Number(e.target.value))} />
                  <span>{Math.round(scale * 100)}%</span>
                </label>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={preview} disabled={busy}><Icon name="Eye" size={14} /> Preview PDF</button>
                  <button onClick={activate} disabled={busy || doc.active}><Icon name="CheckCircle2" size={14} /> Set live</button>
                  <button onClick={removeTemplate} disabled={busy}><Icon name="Trash2" size={14} /></button>
                  <button className="primary" onClick={save} disabled={busy}><Icon name="Save" size={14} /> Save</button>
                </div>
              </div>

              <div className="designer-canvas-wrap">
                <div
                  className="designer-page-sheet"
                  style={{ width: pageW * scale, height: pageH * scale }}
                  onClick={() => setSelectedId(null)}
                >
                  {!doc.blocks.length && (
                    <div className="blank-hint">
                      <Icon name="LayoutGrid" size={26} />
                      <b>Empty page</b>
                      <span>Add a block from the palette on the left to begin.</span>
                    </div>
                  )}
                  {doc.blocks.map((b) => (
                    <CanvasBlock
                      key={b.id}
                      block={b}
                      scale={scale}
                      selected={b.id === selectedId}
                      onSelect={setSelectedId}
                      onChange={patchBlock}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </main>

        {/* ---------------- RIGHT: properties + tokens ---------------- */}
        {doc && (
          <aside className="designer-rail">
            <div className="designer-panel">
              <b>{selected ? `${selected.kind} block` : 'No block selected'}</b>
              {!selected && <span className="muted small">Click a block on the page to edit it.</span>}
              {selected && (
                <div className="designer-props">
                  <div className="prop-row">
                    <label>X<input type="number" value={Math.round(selected.x)} onChange={(e) => setField('x', Number(e.target.value))} /></label>
                    <label>Y<input type="number" value={Math.round(selected.y)} onChange={(e) => setField('y', Number(e.target.value))} /></label>
                  </div>
                  <div className="prop-row">
                    <label>W<input type="number" value={Math.round(selected.w)} onChange={(e) => setField('w', Number(e.target.value))} /></label>
                    <label>H<input type="number" value={Math.round(selected.h)} onChange={(e) => setField('h', Number(e.target.value))} /></label>
                  </div>

                  {!['IMAGE', 'DIVIDER', 'SPACER', 'EARNINGS_TABLE', 'FIELD_GRID', 'TABLE'].includes(selected.kind) && (
                    <label>Text<textarea rows={4} value={selected.text || ''} onChange={(e) => setField('text', e.target.value)} /></label>
                  )}

                  {selected.kind === 'FIELD_GRID' && (
                    <div>
                      <span className="prop-label">Rows</span>
                      {(selected.fields || []).map((f, i) => (
                        <div className="prop-row" key={i}>
                          <input value={f.label} placeholder="Label" onChange={(e) => {
                            const fields = [...selected.fields]; fields[i] = { ...f, label: e.target.value }; setField('fields', fields);
                          }} />
                          <input value={f.value} placeholder="{{token}}" onChange={(e) => {
                            const fields = [...selected.fields]; fields[i] = { ...f, value: e.target.value }; setField('fields', fields);
                          }} />
                          <button className="tiny-btn" onClick={() => setField('fields', selected.fields.filter((_, j) => j !== i))}>×</button>
                        </div>
                      ))}
                      <button className="tiny-btn" onClick={() => setField('fields', [...(selected.fields || []), { label: 'Label', value: '' }])}>+ Add row</button>
                    </div>
                  )}

                  {selected.kind === 'TABLE' && (
                    <div>
                      <span className="prop-label">Cells (comma separated per row)</span>
                      {(selected.rows || []).map((r, i) => (
                        <div className="prop-row" key={i}>
                          <input value={r.join(', ')} onChange={(e) => {
                            const rows = [...selected.rows]; rows[i] = e.target.value.split(',').map((c) => c.trim()); setField('rows', rows);
                          }} />
                          <button className="tiny-btn" onClick={() => setField('rows', selected.rows.filter((_, j) => j !== i))}>×</button>
                        </div>
                      ))}
                      <button className="tiny-btn" onClick={() => setField('rows', [...(selected.rows || []), ['New', '0.00']])}>+ Add row</button>
                    </div>
                  )}

                  {selected.kind === 'IMAGE' && (
                    <label className="doc-upload" style={{ marginTop: 8 }}>
                      {selected.imageDataUrl ? 'Replace image' : 'Upload image'}
                      <input type="file" accept="image/*" onChange={(e) => uploadImage(e.target.files?.[0])} />
                    </label>
                  )}

                  {!['IMAGE', 'SPACER'].includes(selected.kind) && (
                    <>
                      <div className="prop-row">
                        <label>Size<input type="number" value={selected.fontSize || 11} onChange={(e) => setField('fontSize', Number(e.target.value))} /></label>
                        <label>Align
                          <select value={selected.align || 'left'} onChange={(e) => setField('align', e.target.value)}>
                            <option>left</option><option>center</option><option>right</option><option>justify</option>
                          </select>
                        </label>
                      </div>
                      <div className="prop-row">
                        <label>Text<input type="color" value={selected.color || '#1f2937'} onChange={(e) => setField('color', e.target.value)} /></label>
                        <label>Fill<input type="color" value={selected.background || '#ffffff'} onChange={(e) => setField('background', e.target.value)} /></label>
                      </div>
                      <div className="prop-row" style={{ gap: 14 }}>
                        <label className="check"><input type="checkbox" checked={!!selected.bold} onChange={(e) => setField('bold', e.target.checked)} /> Bold</label>
                        <label className="check"><input type="checkbox" checked={!!selected.italic} onChange={(e) => setField('italic', e.target.checked)} /> Italic</label>
                      </div>
                      <button className="tiny-btn" onClick={() => setField('background', '')}>Clear fill</button>
                    </>
                  )}

                  <div className="prop-row" style={{ marginTop: 10 }}>
                    <button className="tiny-btn" onClick={duplicateBlock}><Icon name="Copy" size={13} /> Duplicate</button>
                    <button className="tiny-btn" onClick={removeBlock}><Icon name="Trash2" size={13} /> Delete</button>
                  </div>
                </div>
              )}
            </div>

            <div className="designer-panel">
              <b>Insert live data</b>
              <span className="muted small">Select a text block, then click a token.</span>
              <div className="token-list">
                {meta.tokens.map((g) => (
                  <details key={g.group}>
                    <summary>{g.group}</summary>
                    <div>
                      {g.tokens.map((t) => (
                        <button key={t} onClick={() => insertToken(t)} title={`{{${t}}}`}>{t.split('.')[1]}</button>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
