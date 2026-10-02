import '@vitejs/plugin-react/preamble';
import { createRoot } from 'react-dom/client';
import { SectionApp } from './SectionApp';

for (const element of document.querySelectorAll<HTMLElement>('[data-react-section]')) {
  createRoot(element).render(<SectionApp sectionId={element.dataset.sectionId} />);
}
