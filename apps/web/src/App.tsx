import { API_BASE_URL } from './config';

export function App() {
  return (
    <main className="stub">
      <h1>Канвас</h1>
      <p>Редактор в разработке: текст → генератор → результат.</p>
      <p>
        API: <code>{API_BASE_URL}</code>
      </p>
    </main>
  );
}
