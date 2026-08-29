import { useRef, useState } from 'react';
import api from '../api/client';
import type { AOBounds, DocumentUploadResult, LatLon } from '../types';

interface Props {
  onAOIdentified: (center: LatLon, bounds: AOBounds) => void;
  onExtraction: (result: DocumentUploadResult) => void;
}

const AO_PADDING_DEG = 0.15;

export default function DocumentsPanel({ onAOIdentified, onExtraction }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<DocumentUploadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');

  const handleUpload = async (file: File) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('document', file);
      const { data } = await api.post<DocumentUploadResult>('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
      onExtraction(data);
      if (data.suggestedAO) {
        applyAO(data.suggestedAO.lat, data.suggestedAO.lon);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to process document. Ensure it is a valid PDF, DOCX or TXT file.');
    } finally {
      setLoading(false);
    }
  };

  const applyAO = (lat: number, lon: number) => {
    onAOIdentified(
      { lat, lon },
      {
        north: lat + AO_PADDING_DEG,
        south: lat - AO_PADDING_DEG,
        east: lon + AO_PADDING_DEG,
        west: lon - AO_PADDING_DEG,
      }
    );
  };

  return (
    <div className="documents-panel">
      <h2>Operational Orders Processing</h2>
      <p className="panel-subtitle">Upload a fragmentary/operational order (PDF, DOCX or TXT)</p>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
        }}
      />
      {loading && <p>Parsing document and running NLP extraction...</p>}
      {error && <p className="error-text">{error}</p>}

      {result && (
        <div className="document-results">
          <h3>Extraction Results: {result.filename}</h3>

          <div className="extraction-section">
            <h4>Identified Operational Area</h4>
            {result.suggestedAO ? (
              <p>
                {result.suggestedAO.lat.toFixed(4)}, {result.suggestedAO.lon.toFixed(4)}
                {result.suggestedAO.needsManualConfirmation &&
                  ' (multiple coordinates found - please confirm)'}
              </p>
            ) : (
              <p>No coordinates automatically identified. Please enter the AO location manually:</p>
            )}
            <div className="manual-ao-correction">
              <input
                type="text"
                placeholder="Latitude"
                value={manualLat}
                onChange={(e) => setManualLat(e.target.value)}
              />
              <input
                type="text"
                placeholder="Longitude"
                value={manualLon}
                onChange={(e) => setManualLon(e.target.value)}
              />
              <button
                className="action-btn"
                onClick={() => {
                  const lat = parseFloat(manualLat);
                  const lon = parseFloat(manualLon);
                  if (!Number.isNaN(lat) && !Number.isNaN(lon)) applyAO(lat, lon);
                }}
              >
                Set AO Location
              </button>
            </div>
          </div>

          <div className="extraction-section">
            <h4>Enemy Force Mentions</h4>
            <ul>
              {result.extraction.enemyMentions.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
              {result.extraction.enemyMentions.length === 0 && <li>None identified</li>}
            </ul>
          </div>

          <div className="extraction-section">
            <h4>Friendly Force Mentions</h4>
            <ul>
              {result.extraction.friendlyMentions.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
              {result.extraction.friendlyMentions.length === 0 && <li>None identified</li>}
            </ul>
          </div>

          <div className="extraction-section">
            <h4>Mission Objectives</h4>
            <ul>
              {result.extraction.objectives.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
              {result.extraction.objectives.length === 0 && <li>None identified</li>}
            </ul>
          </div>

          <div className="extraction-section">
            <h4>Matched Doctrine Profiles (simulated ODIN)</h4>
            <ul>
              {result.matchedDoctrine.map((d) => (
                <li key={d.id}>{d.name}</li>
              ))}
              {result.matchedDoctrine.length === 0 && <li>No known doctrine profile matched</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
