-- Keep wallet identity checks in the server routes and make engagement
-- updates atomic so concurrent likes cannot desynchronize the video counters.
CREATE OR REPLACE FUNCTION public.set_video_engagement(
  video_id_param text,
  user_wallet_param text,
  liked_param boolean,
  disliked_param boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous_liked boolean := false;
  previous_disliked boolean := false;
BEGIN
  IF video_id_param IS NULL OR user_wallet_param IS NULL
     OR liked_param IS NULL OR disliked_param IS NULL
     OR (liked_param AND disliked_param) THEN
    RAISE EXCEPTION 'Invalid video engagement values';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(video_id_param || ':' || user_wallet_param, 0)
  );

  SELECT liked, disliked
    INTO previous_liked, previous_disliked
    FROM public.video_engagement
    WHERE video_id = video_id_param
      AND user_wallet = user_wallet_param
    FOR UPDATE;

  previous_liked := COALESCE(previous_liked, false);
  previous_disliked := COALESCE(previous_disliked, false);

  INSERT INTO public.video_engagement (
    video_id, user_wallet, liked, disliked, timestamp, updated_at
  )
  VALUES (
    video_id_param, user_wallet_param, liked_param, disliked_param,
    (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint,
    clock_timestamp()
  )
  ON CONFLICT (video_id, user_wallet) DO UPDATE
    SET liked = EXCLUDED.liked,
        disliked = EXCLUDED.disliked,
        timestamp = EXCLUDED.timestamp,
        updated_at = EXCLUDED.updated_at;

  UPDATE public.videos
    SET likes = GREATEST(0, COALESCE(likes, 0)
        + liked_param::integer - previous_liked::integer),
        dislikes = GREATEST(0, COALESCE(dislikes, 0)
        + disliked_param::integer - previous_disliked::integer)
    WHERE video_id = video_id_param;
END;
$$;

REVOKE ALL ON FUNCTION public.set_video_engagement(text, text, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_video_engagement(text, text, boolean, boolean)
  TO service_role;
