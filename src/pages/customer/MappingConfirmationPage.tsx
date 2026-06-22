import { useEffect, useMemo, useState, type SVGProps } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getProposedMapping, saveConfirmedMapping } from '../../services/MappingService'
import { configureSheet } from '../../services/ConnectorService'
import type { ConfirmedFieldMapping, ProposedMapping } from '../../types/database'
import './MappingConfirmationPage.css'

function ShieldCheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className="ic"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

// Customer's working column choices, keyed by field. Seeded from high-confidence
// proposals; low-confidence fields start empty so the customer must pick.
type Choices = Record<string, string>

function seedChoices(mapping: ProposedMapping): Choices {
  const choices: Choices = {}
  for (const f of mapping.fields) {
    if (f.confidence === 'high' && f.column) choices[f.field] = f.column
  }
  return choices
}

export function MappingConfirmationPage() {
  const { provisionId } = useParams<{ provisionId: string }>()
  const navigate = useNavigate()

  const [mapping, setMapping] = useState<ProposedMapping | null>(null)
  const [choices, setChoices] = useState<Choices>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sheet-picker state: shown when no mapping has been proposed yet. The
  // customer pastes their Google Sheet link; we read it and propose a mapping.
  const [spreadsheetUrl, setSpreadsheetUrl] = useState('')
  const [configuring, setConfiguring] = useState(false)
  const [configureError, setConfigureError] = useState<string | null>(null)

  async function handleConfigure() {
    if (!provisionId || !spreadsheetUrl.trim()) return
    setConfiguring(true)
    setConfigureError(null)
    try {
      const result = await configureSheet(provisionId, spreadsheetUrl.trim())
      setMapping(result)
      setChoices(seedChoices(result))
    } catch (e) {
      setConfigureError(e instanceof Error ? e.message : 'Die Tabelle konnte nicht gelesen werden.')
    } finally {
      setConfiguring(false)
    }
  }

  useEffect(() => {
    if (!provisionId) return
    getProposedMapping(provisionId)
      .then((data) => {
        setMapping(data)
        if (data) setChoices(seedChoices(data))
      })
      .catch(() => setError('Die Spalten-Zuordnung konnte nicht geladen werden.'))
      .finally(() => setLoading(false))
  }, [provisionId])

  // F3 guard #1: confirm stays disabled until EVERY low-confidence field has a
  // column chosen. High-confidence fields are pre-seeded, so this reduces to
  // "no field is missing a choice".
  const allChosen = useMemo(() => {
    if (!mapping) return false
    return mapping.fields.every((f) => Boolean(choices[f.field]))
  }, [mapping, choices])

  function chooseColumn(field: string, column: string) {
    setChoices((prev) => ({ ...prev, [field]: column }))
  }

  // TODO(T6): "Spalten anpassen" full column editor is out of scope for this
  // lane. Stubbed as a toggle that lets the customer re-open every field as a
  // dropdown. A dedicated editor surface will replace this.
  const [editMode, setEditMode] = useState(false)
  function handleAdjustColumns() {
    setEditMode((v) => !v)
  }

  async function handleConfirm() {
    if (!provisionId || !mapping || !allChosen) return
    setSaving(true)
    setError(null)
    const confirmed: ConfirmedFieldMapping[] = mapping.fields.map((f) => ({
      field: f.field,
      column: choices[f.field],
    }))
    try {
      await saveConfirmedMapping(provisionId, confirmed)
      navigate('/my-requests')
    } catch {
      setError('Die Bestätigung konnte nicht gespeichert werden. Bitte erneut versuchen.')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="mapping-wrap">
        <p>Spalten-Zuordnung wird geladen…</p>
      </div>
    )
  }

  if (error && !mapping) {
    return (
      <div className="mapping-wrap">
        <div className="empty-state">
          <p>{error}</p>
        </div>
      </div>
    )
  }

  if (!mapping) {
    return (
      <div className="mapping-wrap">
        <div className="mapping-card">
          <h1>Mit welcher Tabelle sollen wir arbeiten?</h1>
          <p className="muted">
            Füge den Link zu deinem Google Sheet ein. Wir lesen nur die
            Spaltenüberschriften und schlagen dir die passende Zuordnung vor —
            geschrieben wird noch nichts.
          </p>

          <input
            className="sheet-url-input"
            type="url"
            inputMode="url"
            placeholder="https://docs.google.com/spreadsheets/d/…"
            value={spreadsheetUrl}
            onChange={(e) => setSpreadsheetUrl(e.target.value)}
            aria-label="Google-Sheet-Link"
          />

          {configureError && <p style={{ color: 'var(--color-destructive)' }}>{configureError}</p>}

          <div className="mapping-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!spreadsheetUrl.trim() || configuring}
              onClick={handleConfigure}
            >
              {configuring ? 'Tabelle wird gelesen…' : 'Tabelle lesen'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mapping-wrap">
      <div className="mapping-card">
        <h1>Wir schreiben neue Leads in diese Spalten — passt das?</h1>
        <p className="muted">
          Wir haben Ihre Tabelle <b>„{mapping.sheetTitle}"</b> gelesen und die passenden Spalten erkannt.
          Bitte einmal bestätigen, bevor wir starten.
        </p>

        <div className="mapping-rows">
          {mapping.fields.map((field) => {
            const chosen = choices[field.field]
            const needsPick = field.confidence === 'low' && !chosen
            const showDropdown = needsPick || editMode
            const chosenLabel =
              mapping.availableColumns.find((c) => c.value === chosen)?.label ?? field.columnLabel

            return (
              <div className="map-row" key={field.field}>
                <span className="field">{field.label}</span>
                <span className="arrow" aria-hidden="true">
                  →
                </span>

                {showDropdown ? (
                  <select
                    className={needsPick ? 'col-chip col-needs' : 'col-chip'}
                    aria-label={`Spalte für ${field.label} wählen`}
                    value={chosen ?? ''}
                    onChange={(e) => chooseColumn(field.field, e.target.value)}
                  >
                    <option value="" disabled>
                      Bitte Spalte wählen ▾
                    </option>
                    {mapping.availableColumns.map((col) => (
                      <option key={col.value} value={col.value}>
                        {col.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="col-chip">{chosenLabel}</span>
                )}

                <span className="pill-wrap">
                  {field.confidence === 'high' ? (
                    <span className="pill pill-high">● Sicher</span>
                  ) : (
                    <span className="pill pill-mid">● Unsicher</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>

        <div className="preview">
          <b>Beispiel:</b> Ein neuer Lead{' '}
          „{Object.values(mapping.sampleLead).join(' · ')}" landet als neue Zeile —{' '}
          {mapping.fields
            .filter((f) => choices[f.field])
            .map((f) => {
              const col = mapping.availableColumns.find((c) => c.value === choices[f.field])
              return `${f.label} → ${col?.value ?? choices[f.field]}`
            })
            .join(', ')}
          .
        </div>

        <div className="reassure">
          <ShieldCheckIcon />
          <span>
            Wir fügen <b>nur neue Zeilen</b> hinzu. Ihre bestehenden Daten werden nie überschrieben
            oder gelöscht.
          </span>
        </div>

        {error && mapping && <p style={{ color: 'var(--color-destructive)' }}>{error}</p>}

        <div className="mapping-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!allChosen || saving}
            onClick={handleConfirm}
          >
            {saving ? 'Wird gespeichert…' : "Passt, los geht's"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleAdjustColumns}>
            Spalten anpassen
          </button>
        </div>
      </div>
    </div>
  )
}
