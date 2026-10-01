import { createApp } from 'vue';
import SectionApp from '../components/SectionApp.vue';

for (const element of document.querySelectorAll('[data-vue-section]')) {
  createApp(SectionApp, { title: element.dataset.title }).mount(element);
}
