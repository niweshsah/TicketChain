import { RouteScroll } from './RouteScroll';
import { useStickyHeaderOffset } from './useStickyHeaderOffset';
import { useState, useEffect } from 'react';
import {
  Link,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  ticketApi as api,
  clear,
  type RootState,
  type AppDispatch,
} from './store';
import { Profile } from './features/profile';
import { Notice, Gate } from './features/feedback';
import { Home, Discovery, Details } from './features/events';
import { Auth } from './features/auth';
import { Checkout, Confirmation } from './features/orders';
import { Account } from './features/account';
import { Dashboard, Editor, CheckIn } from './features/organizer';
export function App() {
  const headerRef = useStickyHeaderOffset();
  const user = useSelector((s: RootState) => s.auth.user);
  const dispatch = useDispatch<AppDispatch>();
  const [logout, { isLoading }] = api.useLogoutMutation();
  api.useMeQuery();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!user || !new URLSearchParams(location.search).has('oauth')) return;
    const target = sessionStorage.getItem('oauthReturnTo');
    sessionStorage.removeItem('oauthReturnTo');
    if (target?.startsWith('/') && !target.startsWith('//'))
      navigate(target, { replace: true });
  }, [user, location.search, navigate]);
  const [logoutError, setLogoutError] = useState<unknown>();
  async function signOut() {
    try {
      await logout().unwrap();
      dispatch(clear());
      dispatch(api.util.resetApiState());
    } catch (e) {
      setLogoutError(e);
    }
  }
  return (
    <>
      <RouteScroll />
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header ref={headerRef} className="nav">
        <Link className="brand" to="/">
          Ticket<span>Chain</span>
          <small>LIVE A LITTLE LOUDER</small>
        </Link>
        <nav aria-label="Main navigation">
          <Link to="/events">Discover</Link>
          <Link to="/account">My tickets</Link>
          <Link to="/organizer">Organizer</Link>
          {user && <Link to="/profile">Profile</Link>}
          {user ? (
            <button disabled={isLoading} onClick={() => void signOut()}>
              Sign out
            </button>
          ) : (
            <Link
              to={
                /^\/(checkout|orders|organizer|account|profile)(\/|$)/.test(
                  location.pathname,
                )
                  ? `/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`
                  : '/login'
              }
            >
              Sign in
            </Link>
          )}
        </nav>
      </header>
      <main id="main">
        <Notice error={logoutError} />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/events" element={<Discovery />} />
          <Route path="/events/:id" element={<Details />} />
          <Route path="/login" element={<Auth />} />
          <Route path="/register" element={<Auth register />} />
          <Route
            path="/checkout/:id"
            element={
              <Gate>
                <Checkout />
              </Gate>
            }
          />
          <Route
            path="/orders/:id"
            element={
              <Gate>
                <Confirmation />
              </Gate>
            }
          />
          <Route
            path="/profile"
            element={
              <Gate>
                <Profile />
              </Gate>
            }
          />
          <Route
            path="/account"
            element={
              <Gate>
                <Account />
              </Gate>
            }
          />
          <Route
            path="/organizer"
            element={
              <Gate organizer>
                <Dashboard />
              </Gate>
            }
          />
          <Route
            path="/organizer/new"
            element={
              <Gate organizer>
                <Editor />
              </Gate>
            }
          />
          <Route
            path="/organizer/:id/edit"
            element={
              <Gate organizer>
                <Editor />
              </Gate>
            }
          />
          <Route
            path="/organizer/:id/preview"
            element={
              <Gate organizer>
                <Details preview />
              </Gate>
            }
          />
          <Route
            path="/organizer/:id/check-in"
            element={
              <Gate organizer>
                <CheckIn />
              </Gate>
            }
          />
          <Route
            path="*"
            element={
              <div className="panel">
                <h1>Page not found</h1>
                <Link to="/events">Find your next event</Link>
              </div>
            }
          />
        </Routes>
      </main>
      <footer>
        <Link className="brand" to="/">
          TicketChain
        </Link>
        <p>Good music. Real moments. A ticket you can trust.</p>
        <Link to="/events">Explore events</Link> ·{' '}
        <Link to="/organizer">Organize an event</Link>
      </footer>
    </>
  );
}
