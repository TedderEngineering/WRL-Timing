/** Brent's photo when VITE_SUPPORT_PHOTO_URL is set, else his initial. A real face helps (F9 note 2). */
export function SupporterAvatar({ size = 44 }: { size?: number }) {
  const photo = import.meta.env.VITE_SUPPORT_PHOTO_URL as string | undefined;
  const style = { width: size, height: size };
  return photo ? (
    <img src={photo} alt="Brent Tedder" className="flex-none rounded-full object-cover" style={style} />
  ) : (
    <span
      aria-hidden
      className="grid flex-none place-items-center rounded-full bg-[var(--rt-surface-2)] font-semibold text-[var(--rt-text)]"
      style={{ ...style, fontSize: Math.round(size * 0.38) }}
    >
      B
    </span>
  );
}
