// Dev entry for the screens on their own (present.html), independent of the studio's App.
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { route } from '../model/route'
import PresentScreen from './index'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
	<StrictMode>
		<PresentScreen view={route.view === 'speaker' ? 'speaker' : 'audience'} />
	</StrictMode>
)
