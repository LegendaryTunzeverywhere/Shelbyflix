-- Atomic view increments run only from the trusted server-side service role.
CREATE OR REPLACE FUNCTION public.increment_views(video_id_param text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.videos
  SET views = COALESCE(views, 0) + 1
  WHERE video_id = video_id_param;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_views(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_views(text)
  TO service_role;
