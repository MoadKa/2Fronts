import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listAllAutomations, createAutomation, updateAutomation, type NewAutomationInput } from '../../services/AutomationService'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import type { Automation } from '../../types/database'

// The connectors an automation can be fulfilled by. Keep in sync with the
// connector_registry table; the value is written to automations.connector_type
// and copied onto each provision at purchase.
const CONNECTOR_OPTIONS = [
  { value: 'google_sheets', label: 'Google Sheets' },
  { value: 'twilio_missed_call', label: 'Twilio Missed-Call SMS' },
  { value: 'slack_notifications', label: 'Slack' },
]

const EMPTY_FORM: NewAutomationInput = {
  name: '',
  summary: '',
  outcome_description: '',
  category: '',
  price_cents: 0,
  connector_type: 'google_sheets',
  requires_provisioning: false,
  is_active: true,
  pricing_model: 'one_time',
  recurring_interval: null,
}

// One-time vs monthly billing. The DB enforces: subscription ⇒ recurring_interval
// set, one_time ⇒ null, so we always set them together. (Monthly is the only
// recurring interval we expose for now; yearly is a one-line addition.)
function billingPatch(value: string): { pricing_model: 'one_time' | 'subscription'; recurring_interval: 'month' | null } {
  return value === 'subscription'
    ? { pricing_model: 'subscription', recurring_interval: 'month' }
    : { pricing_model: 'one_time', recurring_interval: null }
}

export function AdminCatalogPage() {
  const { showToast } = useToast()
  const { t } = useTranslation()
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<NewAutomationInput>(EMPTY_FORM)
  // Which automation is being edited inline, and the working copy of its fields.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<NewAutomationInput>>({})

  useEffect(() => {
    let mounted = true
    listAllAutomations().then((automations) => {
      if (mounted) {
        setAutomations(automations)
        setLoading(false)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  async function refresh() {
    setAutomations(await listAllAutomations())
  }

  async function handleCreate() {
    await createAutomation(form)
    setForm(EMPTY_FORM)
    showToast(t('adminCatalog.automationAdded'))
    await refresh()
  }

  async function toggleActive(automation: Automation) {
    await updateAutomation(automation.id, { is_active: !automation.is_active })
    await refresh()
  }

  // Open the inline editor for one automation, pre-filled with its current
  // content + price (the fields admins actually change; connector_type is left
  // alone because changing it on a live listing would re-route its provisions).
  function startEdit(automation: Automation) {
    setEditingId(automation.id)
    setEditForm({
      name: automation.name,
      summary: automation.summary,
      outcome_description: automation.outcome_description,
      category: automation.category,
      price_cents: automation.price_cents,
      pricing_model: automation.pricing_model ?? 'one_time',
      recurring_interval: automation.recurring_interval ?? null,
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm({})
  }

  async function saveEdit(id: string) {
    await updateAutomation(id, editForm)
    setEditingId(null)
    setEditForm({})
    showToast(t('adminCatalog.saved'))
    await refresh()
  }

  if (loading) return <p>{t('adminCatalog.loading')}</p>

  return (
    <div>
      <div className="page-header">
        <h1>{t('adminCatalog.title')}</h1>
      </div>

      <Card>
        <h3>{t('adminCatalog.addAutomation')}</h3>
        <Input label={t('adminCatalog.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label={t('adminCatalog.summary')} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
        <Input label={t('adminCatalog.outcomeDescription')} value={form.outcome_description} onChange={(e) => setForm({ ...form, outcome_description: e.target.value })} />
        <Input label={t('adminCatalog.category')} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <Input label={t('adminCatalog.priceCents')} type="number" value={form.price_cents} onChange={(e) => setForm({ ...form, price_cents: Number(e.target.value) })} />
        <label className="admin-field">
          <span>{t('adminCatalog.billing')}</span>
          <select
            value={form.pricing_model ?? 'one_time'}
            onChange={(e) => setForm({ ...form, ...billingPatch(e.target.value) })}
          >
            <option value="one_time">{t('adminCatalog.billingOneTime')}</option>
            <option value="subscription">{t('adminCatalog.billingMonthly')}</option>
          </select>
        </label>
        <label className="admin-field">
          <span>{t('adminCatalog.connectorType')}</span>
          <select
            value={form.connector_type}
            onChange={(e) => setForm({ ...form, connector_type: e.target.value })}
          >
            {CONNECTOR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={form.requires_provisioning ?? false}
            onChange={(e) => setForm({ ...form, requires_provisioning: e.target.checked })}
          />
          <span>{t('adminCatalog.requiresProvisioning')}</span>
        </label>
        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={form.is_active ?? true}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          <span>{t('adminCatalog.activeOnCreate')}</span>
        </label>
        <Button onClick={handleCreate}>{t('adminCatalog.addAutomation')}</Button>
      </Card>

      {automations.map((automation) => (
        <Card key={automation.id} className="my-requests-card">
          <Badge tone={automation.is_active ? 'success' : 'neutral'}>{automation.is_active ? t('adminCatalog.active') : t('adminCatalog.inactive')}</Badge>
          <h3>{automation.name}</h3>

          {editingId === automation.id ? (
            <>
              <Input label={t('adminCatalog.name')} value={editForm.name ?? ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              <Input label={t('adminCatalog.summary')} value={editForm.summary ?? ''} onChange={(e) => setEditForm({ ...editForm, summary: e.target.value })} />
              <Input label={t('adminCatalog.outcomeDescription')} value={editForm.outcome_description ?? ''} onChange={(e) => setEditForm({ ...editForm, outcome_description: e.target.value })} />
              <Input label={t('adminCatalog.category')} value={editForm.category ?? ''} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} />
              <Input label={t('adminCatalog.priceCents')} type="number" value={editForm.price_cents ?? 0} onChange={(e) => setEditForm({ ...editForm, price_cents: Number(e.target.value) })} />
              <label className="admin-field">
                <span>{t('adminCatalog.billing')}</span>
                <select
                  value={editForm.pricing_model ?? 'one_time'}
                  onChange={(e) => setEditForm({ ...editForm, ...billingPatch(e.target.value) })}
                >
                  <option value="one_time">{t('adminCatalog.billingOneTime')}</option>
                  <option value="subscription">{t('adminCatalog.billingMonthly')}</option>
                </select>
              </label>
              <Button onClick={() => saveEdit(automation.id)}>{t('adminCatalog.save')}</Button>
              <Button variant="secondary" onClick={cancelEdit}>{t('adminCatalog.cancel')}</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => startEdit(automation)}>{t('adminCatalog.edit')}</Button>
              <Button variant="secondary" onClick={() => toggleActive(automation)}>
                {automation.is_active ? t('adminCatalog.deactivate') : t('adminCatalog.activate')}
              </Button>
            </>
          )}
        </Card>
      ))}
    </div>
  )
}
