import { BrowserRouter, Route, Routes } from 'react-router-dom';

function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Content Insights Platform</h1>
        <p className="mt-2 text-slate-400">Web app scaffold is running.</p>
      </div>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  );
}
