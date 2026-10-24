export { htmlToText as notesText } from '../export/notes'

export function notesHtml(text: string) {
	return text.split(/\n+/).filter((line) => line.trim()).map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</p>`).join('')
}
