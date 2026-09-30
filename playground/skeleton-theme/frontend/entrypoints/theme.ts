document.documentElement.dataset.vite = 'ready';
void import('../modules/demo').then(({ enhance }) => enhance());
