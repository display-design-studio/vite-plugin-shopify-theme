import '@vitejs/plugin-react/preamble';
import React from 'react';
import { createRoot } from 'react-dom/client';

function SectionApp({ title }) {
  return <strong>{title}</strong>;
}

for (const element of document.querySelectorAll('[data-react-section]')) {
  createRoot(element).render(<SectionApp title={element.dataset.title} />);
}
