import { client, result } from '../lib/client';
import { cities, profileUpdateSchema, registerSchema } from '../contracts';
import { currentUser } from './data';

export function publicUser(user) {
  const metadata = user.user_metadata || {};
  return {
    id: user.id,
    email: user.email,
    name: metadata.display_name || metadata.name || user.email.split('@')[0],
    role: metadata.role === 'organizer' ? 'organizer' : 'attendee',
    wallet: null,
    avatarUrl: metadata.avatar_url || null,
    homeCity: cities.includes(metadata.home_city) ? metadata.home_city : null,
    linkedProviders: (user.identities || [])
      .map((identity) => identity.provider)
      .filter((provider) => ['google', 'github'].includes(provider)),
  };
}

export async function authentication(mode, body) {
  const credentials = { email: body.email.trim(), password: body.password };
  const response =
    mode === 'register'
      ? await client.auth.signUp({
          ...credentials,
          options: {
            data: {
              display_name: registerSchema.parse(body).name,
              role: body.role,
            },
            emailRedirectTo: `${window.location.origin}/login`,
          },
        })
      : await client.auth.signInWithPassword(credentials);
  if (response.error) throw response.error;
  return {
    accessToken: response.data.session?.access_token || '',
    user: publicUser(response.data.user),
  };
}

export async function profile(body) {
  const value = profileUpdateSchema.parse(body);
  const response = await client.auth.updateUser({
    data: { display_name: value.name, home_city: value.homeCity || null },
  });
  if (response.error) throw response.error;
  return publicUser(response.data.user);
}

export async function becomeOrganizer() {
  const response = await client.auth.updateUser({
    data: { role: 'organizer' },
  });
  if (response.error) throw response.error;
  return publicUser(response.data.user);
}

export async function providers() {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`,
    {
      headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
    },
  );
  if (!response.ok)
    throw new Error('Sign-in options are temporarily unavailable');
  const data = await response.json();
  return {
    google: Boolean(data.external?.google),
    github: Boolean(data.external?.github),
  };
}

export async function oauth(provider, body) {
  const options = {
    redirectTo: `${window.location.origin}/profile`,
    skipBrowserRedirect: true,
  };
  const response =
    body.intent === 'link'
      ? await client.auth.linkIdentity({ provider, options })
      : await client.auth.signInWithOAuth({ provider, options });
  if (response.error) throw response.error;
  return { authorizationUrl: response.data.url };
}

export async function avatar(file) {
  const user = await currentUser();
  let path = null;
  if (file) {
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    )
      throw new Error('Choose a JPEG, PNG or WebP up to 5 MB');
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 20000000)
        throw new Error('Choose an image under 20 megapixels');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      const side = Math.min(bitmap.width, bitmap.height);
      canvas
        .getContext('2d')
        .drawImage(
          bitmap,
          (bitmap.width - side) / 2,
          (bitmap.height - side) / 2,
          side,
          side,
          0,
          0,
          512,
          512,
        );
      const image = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.85),
      );
      if (!image) throw new Error('This image could not be processed');
      path = `${user.id}/${crypto.randomUUID()}.webp`;
      await result(
        client.storage
          .from('profile-photos')
          .upload(path, image, { contentType: 'image/webp' }),
      );
    } finally {
      bitmap.close();
    }
  }
  const url = path
    ? client.storage.from('profile-photos').getPublicUrl(path).data.publicUrl
    : null;
  const response = await client.auth.updateUser({ data: { avatar_url: url } });
  if (response.error) {
    if (path) await client.storage.from('profile-photos').remove([path]);
    throw response.error;
  }
  const previous = user.user_metadata?.avatar_url;
  const prefix = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/profile-photos/${user.id}/`;
  if (previous?.startsWith(prefix))
    await client.storage
      .from('profile-photos')
      .remove([`${user.id}/${previous.slice(prefix.length)}`]);
  return publicUser(response.data.user);
}
