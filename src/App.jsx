import { Routes, Route } from 'react-router-dom';
import SessionList from './pages/SessionList.jsx';
import SessionNew from './pages/SessionNew.jsx';
import SessionDetail from './pages/SessionDetail.jsx';
import TrackPlayer from './pages/TrackPlayer.jsx';
import ShareViewer from './pages/ShareViewer.jsx';

export default function App() {
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<SessionList />} />
        <Route path="/session/new" element={<SessionNew />} />
        <Route path="/session/:sessionId" element={<SessionDetail />} />
        <Route path="/session/:sessionId/track/:trackId" element={<TrackPlayer />} />
        <Route path="/r/:shareId" element={<ShareViewer />} />
      </Routes>
    </div>
  );
}
