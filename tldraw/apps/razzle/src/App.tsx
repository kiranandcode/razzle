import { Suspense, lazy, useEffect, useState } from 'react'
import { DeckPicker } from './editor/DeckPicker'
import { Studio } from './editor/Studio'
import { parseRoute } from './model/route'

const PresentScreen = lazy(() => import('./present'))
const SharedView = lazy(() => import('./present/SharedView'))

function useRoute() {
	const [route, setRoute] = useState(parseRoute)
	useEffect(() => {
		const onHash = () => setRoute(parseRoute())
		window.addEventListener('hashchange', onHash)
		return () => window.removeEventListener('hashchange', onHash)
	}, [])
	return route
}

const go = (deckId: string | null) => {
	location.hash = deckId ? `#/?deck=${encodeURIComponent(deckId)}` : '#/'
}

export default function App() {
	const route = useRoute()
	if (route.view === 'shared') {
		return (
			<Suspense fallback={null}>
				<SharedView />
			</Suspense>
		)
	}
	if (route.view !== 'editor') {
		return (
			<Suspense fallback={null}>
				<PresentScreen key={route.view} view={route.view} deckId={route.deckId} />
			</Suspense>
		)
	}
	return (
		<div className="rz-app">
			{route.deckId ? <Studio deckId={route.deckId} onOpenDecks={() => go(null)} /> : <DeckPicker onOpen={go} />}
		</div>
	)
}
