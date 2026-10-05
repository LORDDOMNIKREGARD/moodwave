import { HugeiconsIcon } from '@hugeicons/react';

/** One icon library for the whole project (Hugeicons), one stroke width. */
export default function Icon({ icon, size = 18, strokeWidth = 1.6, ...rest }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={strokeWidth} aria-hidden="true" focusable="false" {...rest} />;
}
