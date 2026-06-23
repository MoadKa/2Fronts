import { Component, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface Props { children: ReactNode }
interface State { hasError: boolean }

function ErrorBoundaryFallback() {
  const { t } = useTranslation()
  return <p>{t('errorBoundary.message')}</p>
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return <ErrorBoundaryFallback />
    }
    return this.props.children
  }
}
