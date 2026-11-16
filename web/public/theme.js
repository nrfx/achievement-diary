// Применяет сохранённую тему до первой отрисовки, чтобы не было вспышки.
// Отдельный файл, а не inline-скрипт: так требует строгий CSP.
(function () {
  try {
    var theme = localStorage.getItem('diary:theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch (e) {}
})();
