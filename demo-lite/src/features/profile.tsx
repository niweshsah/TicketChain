import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ticketApi as api } from '../store';
import { SocialAuth } from './social-auth';
import { CitySelect } from '../CitySelect';
import type { PublicUser } from '@ticketchain/shared';
import { Notice } from './feedback';

export function Profile() {
  const { data: user, error } = api.useMeQuery();
  const [city, setCity] = useState('');
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [photoError, setPhotoError] = useState<unknown>();
  const [avatar, photoMutation] = api.useAvatarMutation();
  useEffect(() => {
    if (!file) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const [name, setName] = useState('');
  const [save, mutation] = api.useUpdateProfileMutation();
  useEffect(() => {
    if (user) {
      setName(user.name);
      setCity(user.homeCity || '');
    }
  }, [user]);
  if (!user) return <Notice error={error}>Loading your profile…</Notice>;
  return (
    <section className="section narrow profile-layout">
      <div>
        <span className="eyebrow">YOUR ACCOUNT</span>
        <h1>Your profile</h1>
      </div>
      <div className="panel">
        <h2>Profile photo</h2>
        <div className="profile-avatar">
          {preview || user.avatarUrl ? (
            <img src={preview || user.avatarUrl!} alt="Your profile" />
          ) : (
            user.name.slice(0, 1).toUpperCase()
          )}
        </div>
        <label>
          Choose photo
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (
                selected &&
                (!['image/jpeg', 'image/png', 'image/webp'].includes(
                  selected.type,
                ) ||
                  selected.size > 5 * 1024 * 1024)
              ) {
                setPhotoError(
                  new Error(
                    selected.size > 5 * 1024 * 1024
                      ? 'Choose an image up to 5 MB'
                      : 'Choose a JPEG, PNG or WebP image',
                  ),
                );
                setFile(undefined);
                e.target.value = '';
                return;
              }
              setPhotoError(undefined);
              setFile(selected);
            }}
          />
        </label>
        <p>
          JPEG, PNG or WebP · up to 5 MB. Photos are resized and metadata
          removed.
        </p>
        <div className="actions">
          <button
            disabled={!file || photoMutation.isLoading}
            onClick={() => {
              void avatar(file!)
                .unwrap()
                .then(() => setFile(undefined))
                .catch(() => undefined);
            }}
          >
            {photoMutation.isLoading ? 'Saving photo…' : 'Save photo'}
          </button>
          <button
            disabled={photoMutation.isLoading || (!file && !user.avatarUrl)}
            onClick={() => {
              if (file) setFile(undefined);
              else
                void avatar(null)
                  .unwrap()
                  .catch(() => undefined);
            }}
          >
            Remove photo
          </button>
        </div>
        <Notice error={photoError || photoMutation.error} />
        <h2>Personal details</h2>
        <p>{user.email}</p>
        <p>
          {user.role === 'organizer' ? 'Attendee and organizer' : 'Attendee'}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save({
              name,
              homeCity: (city || null) as PublicUser['homeCity'],
            })
              .unwrap()
              .catch(() => undefined);
          }}
        >
          <label>
            Display name
            <input
              value={name}
              required
              minLength={2}
              maxLength={100}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="form-field">
            <span>Home city (optional)</span>
            <CitySelect
              value={city}
              onChange={setCity}
              emptyLabel="No home city"
            />
          </div>
          <button
            className="button"
            disabled={
              mutation.isLoading ||
              (name.trim() === user.name && city === (user.homeCity || ''))
            }
          >
            {mutation.isLoading ? 'Saving…' : 'Save profile'}
          </button>
        </form>
        <Notice error={mutation.error} />
        {mutation.isSuccess &&
          name.trim() === user.name &&
          city === (user.homeCity || '') && <Notice>Profile saved.</Notice>}
        <div className="actions">
          <Link to="/account">Tickets and orders ↗</Link>
          <Link to="/organizer">
            {user.role === 'organizer'
              ? 'Organizer dashboard ↗'
              : 'Become an organizer ↗'}
          </Link>
        </div>
      </div>
      <div className="panel">
        <h2>Connected sign-ins</h2>
        <p>
          {user.linkedProviders?.length
            ? user.linkedProviders
                .map((provider) =>
                  provider === 'google' ? 'Google' : 'GitHub',
                )
                .join(' · ')
            : 'No social sign-ins linked yet.'}
        </p>
        <SocialAuth linking />
      </div>
    </section>
  );
}
