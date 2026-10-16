# UI fonts

Noto Sans Thai Regular and Bold are unmodified TTF files from Debian fonts-noto-core. Aetheria Latin Regular and Bold are WOFF subsets of the corresponding Noto Sans fonts (Latin1, general punctuation and arrows), renamed internally with FontTools. Original copyright and license metadata are retained. See OFL.txt.

Upstream: https://github.com/notofonts/thai and https://github.com/notofonts/latin-greek-cyrillic (previously googlei18n/noto-fonts).

The composite CSS family loads both Thai and Latin faces before the runtime starts, keeping Thai wrapping, prices and button geometry consistent without a third-party font request. The original Thai files are about38KB each; the Latin subsets are smaller than the full Noto Sans distribution.
