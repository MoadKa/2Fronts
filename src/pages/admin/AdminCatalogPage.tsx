import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listAllAutomations, createAutomation, updateAutomation, type NewAutomationInput } from '../../services/AutomationService'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import type { Automation } from '../../types/database'

const EMPTY_FORM: NewAutomationInput = { name: '', summary: '', outcome_description: '', category: '', price_cents: 0 }

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
