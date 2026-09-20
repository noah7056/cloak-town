import { getSupabase } from "./supabase";

export type GalleryItem = {
  id: string;
  owner_id: string;
  path: string;
  pinned: boolean;
  pinned_at: string | null;
  created_at: string;
  url: string;
};

function publicUrl(path: string): string {
  const c = getSupabase();
  if (!c) return "";
  return c.storage.from("gallery").getPublicUrl(path).data.publicUrl;
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `g-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Upload a jpeg dataURL to your gallery wall. Returns the new row. */
export async function saveGalleryPhoto(jpegDataUrl: string): Promise<GalleryItem> {
  const c = getSupabase();
  if (!c) throw new Error("accounts unavailable");
  const { data: { user } } = await c.auth.getUser();
  if (!user) throw new Error("log in to save photos");
  const res = await fetch(jpegDataUrl);
  const blob = await res.blob();
  const path = `${user.id}/${uid()}.jpg`;
  const { error: upErr } = await c.storage.from("gallery").upload(path, blob, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (upErr) throw upErr;
  const { data, error: dbErr } = await c
    .from("gallery_items")
    .insert({ owner_id: user.id, path })
    .select("id, owner_id, path, pinned, pinned_at, created_at")
    .single();
  if (dbErr) throw dbErr;
  const row = data as Omit<GalleryItem, "url">;
  return { ...row, url: publicUrl(row.path) };
}

/** Newest-first gallery for an owner (anyone signed in may browse). */
export async function listGallery(ownerId: string, limit = 60): Promise<GalleryItem[]> {
  const c = getSupabase();
  if (!c) return [];
  const { data, error } = await c
    .from("gallery_items")
    .select("id, owner_id, path, pinned, pinned_at, created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data || []) as Omit<GalleryItem, "url">[]).map((r) => ({ ...r, url: publicUrl(r.path) }));
}

/** Pinned photos for a profile card (max 3, pinned-first). */
export async function listPinned(ownerId: string): Promise<GalleryItem[]> {
  const c = getSupabase();
  if (!c) return [];
  const { data, error } = await c
    .from("gallery_items")
    .select("id, owner_id, path, pinned, pinned_at, created_at")
    .eq("owner_id", ownerId)
    .eq("pinned", true)
    .order("pinned_at", { ascending: false })
    .limit(3);
  if (error) throw error;
  return ((data || []) as Omit<GalleryItem, "url">[]).map((r) => ({ ...r, url: publicUrl(r.path) }));
}

export async function setPinned(id: string, pinned: boolean): Promise<void> {
  const c = getSupabase();
  if (!c) throw new Error("accounts unavailable");
  const { error } = await c
    .from("gallery_items")
    .update({ pinned, pinned_at: pinned ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteGalleryItem(id: string, path: string): Promise<void> {
  const c = getSupabase();
  if (!c) throw new Error("accounts unavailable");
  const { error: dbErr } = await c.from("gallery_items").delete().eq("id", id);
  if (dbErr) throw dbErr;
  await c.storage.from("gallery").remove([path]);
}

/** Download any (public) URL to the PC via a blob + anchor click. */
export async function downloadUrl(url: string, name: string): Promise<void> {
  const res = await fetch(url);
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
