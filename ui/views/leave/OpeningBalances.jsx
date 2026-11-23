import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Card, ErrorBox } from '../../components/Ui.jsx';
import ImportResult from '../../components/ImportResult.jsx';
import { api, post } from '../../api/client.js';

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
}

/**
 * Leave balances from Excel: each person's balance becomes the number in the
 * file (moving from greytHR, say). It replaces the balance rather than adding
 * to it, so the same file uploaded twice changes nothing.
 */
export default function OpeningBalances({ onImported }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function downloadTemplate() {
    try {
      const blob = await api('/leaves/balances/template.xlsx');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'JPK-Leave-Balances-Template.xlsx'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { toast.error(err.message || 'Could not download the template'); }
  }

  async function upload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setResult(null); setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await post('/leaves/balances/import-excel', { fileName: file.name, dataUrl });
      setResult({ fileName: file.name, ...res });
      onImported?.();
    } catch (err) { setError(err); } finally { e.target.value = ''; }
  }

  return <Card title="Opening balances from Excel">
    <p className="opening-balances-note">Sets each person's leave balance to the number in the file, for example when moving from greytHR. It replaces the balance, it does not add to it, so uploading the same file again changes nothing.</p>
    <div className="salary-editor-actions">
      <button type="button" onClick={downloadTemplate}>Download Excel template</button>
      <label className="file-button">Upload balances Excel<input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={upload} /></label>
    </div>
    <ErrorBox error={error} />
    {result && <div className="opening-balances-result"><ImportResult
      title={`Leave balances · ${result.fileName}`}
      facts={[`${result.updated || 0} balance${result.updated === 1 ? '' : 's'} set`, result.unchanged ? `${result.unchanged} already right` : null]}
      errors={result.errors || []}
      warnings={result.warnings || []}
      onClose={() => setResult(null)} /></div>}
  </Card>;
}
