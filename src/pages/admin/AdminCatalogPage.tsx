import { useEffect, useState } from 'react'
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
    showToast('Automation added')
    await refresh()
  }

  async function toggleActive(automation: Automation) {
    await updateAutomation(automation.id, { is_active: !automation.is_active })
    await refresh()
  }

  if (loading) return <p>Loading catalog...</p>

  return (
    <div>
      <div className="page-header">
        <h1>Admin catalog</h1>
      </div>

      <Card>
        <h3>Add automation</h3>
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Summary" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
        <Input label="Outcome description" value={form.outcome_description} onChange={(e) => setForm({ ...form, outcome_description: e.target.value })} />
        <Input label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <Input label="Price (cents)" type="number" value={form.price_cents} onChange={(e) => setForm({ ...form, price_cents: Number(e.target.value) })} />
        <Button onClick={handleCreate}>Add automation</Button>
      </Card>

      {automations.map((automation) => (
        <Card key={automation.id} className="my-requests-card">
          <Badge tone={automation.is_active ? 'success' : 'neutral'}>{automation.is_active ? 'active' : 'inactive'}</Badge>
          <h3>{automation.name}</h3>
          <Button variant="secondary" onClick={() => toggleActive(automation)}>
            {automation.is_active ? 'Deactivate' : 'Activate'}
          </Button>
        </Card>
      ))}
    </div>
  )
}
