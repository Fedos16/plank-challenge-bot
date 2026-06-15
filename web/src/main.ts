import { createApp } from 'vue';
import App from './App.vue';
import { initTelegram } from './telegram';
import './styles.css';

initTelegram();

createApp(App).mount('#root');
