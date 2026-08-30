import React, { useEffect, useState } from 'react';
import api from '../utils/api.js';

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentUpload({ scenarioId = 'default', onDocumentsChange }) {
  const [documents, setDocuments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState('Intel');
  const [status, setStatus] = useState('');

  async function loadDocuments() {
    const data = await api.getTacticalDocuments(scenarioId);
    const nextDocuments = data.documents || [];
    setDocuments(nextDocuments);
    onDocumentsChange?.(nextDocuments);
  }

  useEffect(() => {
    loadDocuments().catch((err) => setStatus(err.message));
  }, [scenarioId]);

  async function uploadFile(file) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setStatus('File exceeds the 50 MB limit');
      return;
    }

    setStatus(`Uploading ${file.name}...`);
    try {
      await api.uploadTacticalDocument({ file, scenarioId, tags });
      await loadDocuments();
      setStatus('Upload complete');
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function search(event) {
    event.preventDefault();
    if (!query.trim()) {
      await loadDocuments();
      return;
    }
    const data = await api.searchTacticalDocuments(query, scenarioId);
    setDocuments(data.documents || []);
  }

  async function loadPreview(documentId) {
    const preview = await api.getTacticalDocumentPreview(documentId);
    setSelected(preview);
  }

  async function deleteDocument(documentId) {
    await api.deleteTacticalDocument(documentId);
    if (selected?.id === documentId) setSelected(null);
    await loadDocuments();
  }

  return (
    <section className="document-upload-panel">
      <header>
        <h2>Documents</h2>
        <form onSubmit={search}>
          <input
            placeholder="Search documents..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit">Search</button>
        </form>
      </header>
      <div
        className="document-dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          uploadFile(event.dataTransfer.files[0]);
        }}
      >
        <label>
          Upload PDF, DOCX, TXT, JPG or PNG
          <input
            type="file"
            accept=".pdf,.docx,.txt,.jpg,.jpeg,.png"
            onChange={(event) => uploadFile(event.target.files[0])}
          />
        </label>
        <label>
          Tags
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Intel, Terrain" />
        </label>
      </div>
      {status && <p className="document-status">{status}</p>}
      <div className="document-layout">
        <ul className="document-list">
          {documents.map((document) => (
            <li key={document.id}>
              <button type="button" onClick={() => loadPreview(document.id)}>
                📄 <strong>{document.filename}</strong>
                <small>
                  {formatBytes(document.fileSize)} · {new Date(document.uploadedAt).toLocaleString()}
                </small>
                <span>{(document.tags || []).map((tag) => `#${tag}`).join(' ')}</span>
              </button>
              <button type="button" className="danger-button" onClick={() => deleteDocument(document.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
        <article className="document-preview">
          <h3>Preview</h3>
          {selected ? (
            <>
              <strong>{selected.filename}</strong>
              <pre>{selected.preview?.text || `${selected.fileType.toUpperCase()} preview available after text extraction.`}</pre>
            </>
          ) : (
            <p>Select a document to preview the first 500 characters.</p>
          )}
        </article>
      </div>
    </section>
  );
}
