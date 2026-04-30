import { Navigate, useLocation } from 'react-router-dom';

export function Register() {
  const location = useLocation();
  const search = location.search || '';
  return <Navigate to={`/login${search}`} replace />;
}
