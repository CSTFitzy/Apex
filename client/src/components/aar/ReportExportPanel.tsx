import { reportUrl } from '../../api/aar';

interface Props {
  operationId: string;
}

/** Multi-format AAR report export/download links (JSON, CSV, HTML). */
export default function ReportExportPanel({ operationId }: Props) {
  return (
    <div className="aar-report-export">
      <h3>Export After-Action Report</h3>
      <p className="hint-text">
        Reports include the operation summary, per-unit performance analytics, commander effectiveness scores, and
        AI-generated lessons learned.
      </p>
      <div className="terrain-actions">
        <a className="action-btn" href={reportUrl(operationId, 'json')} target="_blank" rel="noreferrer">
          ⬇ JSON
        </a>
        <a className="action-btn" href={reportUrl(operationId, 'csv')} target="_blank" rel="noreferrer">
          ⬇ CSV
        </a>
        <a className="action-btn" href={reportUrl(operationId, 'html')} target="_blank" rel="noreferrer">
          ⬇ HTML
        </a>
      </div>
    </div>
  );
}
