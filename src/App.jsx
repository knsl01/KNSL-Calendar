// App entry — thin wrapper around the KALA application.
// As the app grows, routing (e.g. react-router) and global providers
// (auth, analytics) would live here, keeping KalaApp focused on the UI.
import KalaApp from "./app/KalaApp.jsx";

export default function App() {
  return <KalaApp />;
}
