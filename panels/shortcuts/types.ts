export type ShortcutLink = { label: string; url: string };
export type Shortcut = {
  id: string;
  label: string;
  logo?: string;
  links: ShortcutLink[];
};
