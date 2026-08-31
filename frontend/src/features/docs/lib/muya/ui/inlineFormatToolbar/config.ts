import { isOsx } from '../../config';
import { lucideIcons } from '../../utils/icons';

const COMMAND_KEY = isOsx ? '⌘' : 'Ctrl';

const icons = [
    {
        type: 'strong',
        tooltip: 'Emphasize',
        shortcut: `${COMMAND_KEY}+B`,
        icon: lucideIcons.bold,
    },
    {
        type: 'em',
        tooltip: 'Italic',
        shortcut: `${COMMAND_KEY}+I`,
        icon: lucideIcons.italic,
    },
    {
        type: 'u',
        tooltip: 'Underline',
        shortcut: `${COMMAND_KEY}+U`,
        icon: lucideIcons.underline,
    },
    {
        type: 'del',
        tooltip: 'Strikethrough',
        shortcut: `${COMMAND_KEY}+D`,
        icon: lucideIcons.strike,
    },
    {
        type: 'mark',
        tooltip: 'Highlight',
        shortcut: `⇧+${COMMAND_KEY}+H`,
        icon: lucideIcons.highlight,
    },
    {
        type: 'inline_code',
        tooltip: 'Inline Code',
        shortcut: `${COMMAND_KEY}+\``,
        icon: lucideIcons.code,
    },
    {
        type: 'inline_math',
        tooltip: 'Inline Math',
        shortcut: `⇧+${COMMAND_KEY}+M`,
        icon: lucideIcons.math,
    },
    {
        type: 'link',
        tooltip: 'Link',
        shortcut: `${COMMAND_KEY}+L`,
        icon: lucideIcons.link,
    },
    {
        type: 'image',
        tooltip: 'Image',
        shortcut: `⇧+${COMMAND_KEY}+I`,
        icon: lucideIcons.image,
    },
    {
        type: 'comment',
        tooltip: 'Comment',
        shortcut: `${COMMAND_KEY}+Alt+M`,
        icon: lucideIcons.comment,
    },
    {
        type: 'clear',
        tooltip: 'Eliminate',
        shortcut: `⇧+${COMMAND_KEY}+R`,
        icon: lucideIcons.clear,
    },
];

export type FormatToolIcon = typeof icons[number];

export default icons;
