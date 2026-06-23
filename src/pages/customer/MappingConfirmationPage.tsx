import { useEffect, useMemo, useState, type SVGProps } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()

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
      setConfigureError(e instanceof Error ? e.message : t('mapping.readErrorFallback'))
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
      .catch(() => setError(t('mapping.loadError')))
      .finally(() => setLoading(false))
  }, [provisionId, t])

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
      setError(t('mapping.saveError'))
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="mapping-wrap">
        <p>{t('mapping.loading')}</p>
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
          <h1>{t('mapping.pickerTitle')}</h1>
          <p className="muted">{t('mapping.pickerBody')}</p>

          <input
            className="sheet-url-input"
            type="url"
            inputMode="url"
            placeholder="https://docs.google.com/spreadsheets/d/…"
            value={spreadsheetUrl}
            onChange={(e) => setSpreadsheetUrl(e.target.value)}
            aria-label={t('mapping.sheetLinkLabel')}
          />

          {configureError && <p style={{ color: 'var(--color-destructive)' }}>{configureError}</p>}

          <div className="mapping-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!spreadsheetUrl.trim() || configuring}
              onClick={handleConfigure}
            >
              {configuring ? t('mapping.readingTable') : t('mapping.readTable')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mapping-wrap">
      <div className="mapping-card">
        <h1>{t('mapping.confirmTitle')}</h1>
        <p className="muted">
          <Trans
            i18nKey="mapping.confirmBody"
            values={{ sheetTitle: mapping.sheetTitle }}
            components={{ bold: <b /> }}
          />
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
                    aria-label={t('mapping.chooseColumnFor', { label: field.label })}
                    value={chosen ?? ''}
                    onChange={(e) => chooseColumn(field.field, e.target.value)}
                  >
                    <option value="" disabled>
                      {t('mapping.pleaseChooseColumn')}
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
                    <span className="pill pill-high">{t('mapping.confident')}</span>
                  ) : (
                    <span className="pill pill-mid">{t('mapping.unsure')}</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>

        <div className="preview">
          <b>{t('mapping.exampleLabel')}</b>{' '}
          {t('mapping.exampleBody', {
            sample: Object.values(mapping.sampleLead).join(' · '),
            mappings: mapping.fields
              .filter((f) => choices[f.field])
              .map((f) => {
                const col = mapping.availableColumns.find((c) => c.value === choices[f.field])
                return `${f.label} → ${col?.value ?? choices[f.field]}`
              })
              .join(', '),
          })}
        </div>

        <div className="reassure">
          <ShieldCheckIcon />
          <span>
            <Trans i18nKey="mapping.reassure" components={{ bold: <b /> }} />
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
            {saving ? t('mapping.saving') : t('mapping.confirm')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleAdjustColumns}>
            {t('mapping.adjustColumns')}
          </button>
        </div>
      </div>
    </div>
  )
}
