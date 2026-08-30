import { useEffect, useState } from 'react';
import type { LessonCategory, LessonInsight } from '../../types';
import { getLessons } from '../../api/aar';

interface Props {
  operationId: string;
}

const CATEGORY_LABELS: Record<LessonCategory, string> = {
  what_went_well: '✅ What Went Well',
  what_could_improve: '⚠️ What Could Improve',
  doctrinal_alignment: '📘 Doctrinal Alignment',
  enemy_analysis: '🎯 Enemy Analysis',
  environmental_factors: '🌦 Environmental Factors',
  training_recommendations: '🎓 Training Recommendations',
};

const CATEGORY_ORDER: LessonCategory[] = [
  'what_went_well',
  'what_could_improve',
  'doctrinal_alignment',
  'enemy_analysis',
  'environmental_factors',
  'training_recommendations',
];

/** AI-generated lessons learned across the 6 standard AAR insight categories, with search. */
export default function LessonsLearnedPanel({ operationId }: Props) {
  const [lessons, setLessons] = useState<LessonInsight[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLessons(operationId, query)
      .then((data) => {
        if (!cancelled) setLessons(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [operationId, query]);

  return (
    <div className="aar-lessons">
      <input
        type="text"
        placeholder="Search lessons learned..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading && <p className="hint-text">Loading lessons...</p>}
      {CATEGORY_ORDER.map((category) => {
        const categoryLessons = lessons.filter((l) => l.category === category);
        if (categoryLessons.length === 0) return null;
        return (
          <div key={category} className="lesson-category">
            <h4>{CATEGORY_LABELS[category]}</h4>
            <ul>
              {categoryLessons.map((l) => (
                <li key={l.id} className={`lesson-severity-${l.severity}`}>
                  <strong>{l.title}</strong> <span className="lesson-badge">{l.severity}</span>
                  <p>{l.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {!loading && lessons.length === 0 && <p className="hint-text">No lessons match your search.</p>}
    </div>
  );
}
