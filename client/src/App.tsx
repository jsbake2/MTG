import { useEffect } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/store/auth";
import { Login } from "@/pages/Login";
import { Browse } from "@/pages/Browse";
import { Decks } from "@/pages/Decks";
import { DeckBuilder } from "@/pages/DeckBuilder";
import { Play } from "@/pages/Play";
import { TablePage } from "@/pages/Table";
import { Admin } from "@/pages/Admin";

function NavBar() {
  const { user, logout } = useAuth();
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-md text-sm font-semibold ${isActive ? "bg-table-accent text-black" : "text-table-ink hover:bg-table-panel2"}`;
  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-table-border bg-table-panel/95 px-3 py-2 backdrop-blur">
      <div className="mr-2 font-display text-lg text-table-accentSoft">⚔ MTG Home Table</div>
      <nav className="flex flex-wrap items-center gap-1">
        <NavLink to="/browse" className={linkClass}>
          Cards
        </NavLink>
        <NavLink to="/decks" className={linkClass}>
          Decks
        </NavLink>
        <NavLink to="/play" className={linkClass}>
          Play
        </NavLink>
        {user?.isAdmin && (
          <NavLink to="/admin" className={linkClass}>
            Admin
          </NavLink>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-2 text-sm">
        <span className="text-table-muted">
          {user?.displayName}
          {user?.isAdmin ? " · admin" : ""}
        </span>
        <button className="btn-ghost" onClick={() => logout()}>
          Sign out
        </button>
      </div>
    </header>
  );
}

export function App() {
  const { user, loading, init } = useAuth();
  const location = useLocation();

  useEffect(() => {
    init();
  }, [init]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-table-muted">Loading…</div>;
  }
  if (!user) {
    return <Login />;
  }

  // The table page is full-bleed (no chrome) for maximum board space.
  const isTable = location.pathname.startsWith("/table/");

  return (
    <div className="flex h-full flex-col">
      {!isTable && <NavBar />}
      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/browse" replace />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/decks" element={<Decks />} />
          <Route path="/decks/:id" element={<DeckBuilder />} />
          <Route path="/decks/new" element={<DeckBuilder />} />
          <Route path="/play" element={<Play />} />
          <Route path="/table/:id" element={<TablePage />} />
          {user.isAdmin && <Route path="/admin" element={<Admin />} />}
          <Route path="*" element={<Navigate to="/browse" replace />} />
        </Routes>
      </main>
    </div>
  );
}
