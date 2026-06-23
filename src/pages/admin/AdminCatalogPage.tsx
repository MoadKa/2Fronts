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
}

export function AdminCatalogPage() {
  const { showToast } = useToast()
  const { t } = useTranslation()
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<NewAutomationInput>(EMPTY_FORM)

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
          <Button variant="secondary" onClick={() => toggleActive(automation)}>
            {automation.is_active ? t('adminCatalog.deactivate') : t('adminCatalog.activate')}
          </Button>
        </Card>
      ))}
    </div>
  )
}
