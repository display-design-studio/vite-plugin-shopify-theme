import { createApp } from 'vue';
import SectionApp from './SectionApp.vue';

for (const element of document.querySelectorAll<HTMLElement>('[data-vue-section]')) {
  createApp(SectionApp, { sectionId: element.dataset.sectionId }).mount(element);
}
