# NexusDB .nx1 tables: reconnaissance

These are the notes from looking at what is inside a .leap area, before deciding whether
the port should read the tables directly. The short answer is that it should not, yet, and
this records why rather than leaving the next reader to rediscover it.

## What was examined

The vendor ships sample areas as zips of NexusDB tables. `_defaultNX.zip` is the empty
template and therefore the simplest case, so the smallest tables in it were read first:
`$SQL$FUNCTIONS.nx1`, `$SQL$PROCEDURES.nx1`, `$SQL$TRIGGERS.nx1`, `$SQL$VIEWS.nx1` and
`aggresultscache.nx1`, each 20480 bytes, which is five blocks of 4096.

## The file header is readable

Block 0 is structured. It opens with the signature `NX!2`, then version and size fields,
then Pascal-style strings: `nx1xdefault`, `nx1xDefault`, and the data dictionary words
`Stream`, `Blob`, `Record` and `Indices`. Its entropy is 0.41 and 3962 of its 4096 bytes are
zero, so it is plain text with padding.

## The payload is not

Blocks 1 to 4 have entropy between 7.947 and 7.954, which is close to the 8.0 maximum, with
only about 20 zero bytes each. An *empty* table would be mostly zeros, so those blocks are
obscured rather than merely sparse. A repeating XOR with the key `nx1xdefault` leaves the
entropy unchanged at 7.95 and produces no readable runs, so it is not that simple.

## Where the key comes from

The decompilation shows the tables being built. In `chunk-00170.c`, while constructing
`$SQL$PROCEDURES`, lines 2169 to 2174 set a dictionary field to `nx1xdefault` next to the
GUID `{C4B5DAD7-4583-4433-93E0-0F4D2BA750E9}`. So the tables are created with a fixed key
and a fixed engine identifier, which is obfuscation rather than a secret, and it is baked
into the schema code rather than supplied per area.

## The cipher units, and a test that failed

The decompilation keeps NexusDB's own source file names inside its assertion strings, so the
engine layout can be read straight off it: about eighty units, among them
`nxllBaseCipher.pas`, `nxllBlowfishRC4.pas`, `nxsrEncryptionEngineBase.pas`, and
`nxllBaseCompressor.pas` with `nxllLz4MM.pas`. The cipher family is therefore Blowfish and
RC4, with an LZ4 compressor beside them. `TnxBaseEncryptionEngine` carries a
`ReservedSpacePerBlock` property, which fits the header field read earlier: 4096 less 20 is
4076, the value at offset 0x1c, so twenty bytes of every block are reserved for the cipher
rather than for data.

RC4 is twenty lines, so it was tried rather than assumed. A block from the empty template
was decrypted with each of five candidate keys at six different offsets, and the best result
was 24 zero bytes out of 4096, against a baseline of about 20. An empty table would decrypt
to mostly zeros, so none of those is the transform. That leaves Blowfish, an RC4 key derived
some other way, or a NexusDB construction of its own.

It is Blowfish, and it is the published one. The constant table sits in the binary at
`0x02ef2be8`: 1042 words, whose first twelve are the standard P-array and whose last word is
`0x3ac372e6`, the published final S-box entry. Immediately after it come the bytes
`ABCDEFGH...Zabc...`, which is the key of the Blowfish test vectors. So what is in the binary
is the reference implementation with its own constants and self-test data, not a variant of
the algorithm.

That changes the size of what remains. Blowfish is fully specified, so the algorithm does not
have to be recovered at all; what is unknown is only the mode and how the key is derived from
`nx1xdefault`.

## Fitting the mode by experiment did not work, and the code says why

Blowfish was implemented against the constants extracted from the binary, and it reproduces
four of the five standard test vectors, the all-zero and all-`ff` ones among them, so the
implementation is sound. It was then pointed at a block of the empty template under seven
candidate keys, at six region lengths, in ECB and in CBC with three different
initialisation vectors. Nothing beat the baseline: the best was 17 zero bytes out of 4096
against 18 before decryption, and an empty table should be mostly zeros.

Reading the cipher code rather than guessing at it explains that, and narrows the next step
considerably. The block routine is `FUN_01533880` at `0x01533880`. It asserts that the
length is a multiple of eight, then walks the buffer eight bytes at a time, taking the two
words, XORing each with a keystream word from `FUN_015343d0`, and handing both to
`FUN_015327d0`, which is the Blowfish-shaped step. The state it works from lives at offsets
`0x1058`, `0x1060`, `0x1064`, `0x1071` and `0x1075` of the cipher object.

So it is not ECB and it is not CBC. It is a keystream XOR followed by the block step, which
is why a plain Blowfish decryption produced noise, and why the unit is called Blowfish and
RC4 together.

## Both halves of that, read out of the code

`FUN_015343d0` is plain RC4. Its S-box is 256 bytes at offset 8 of its object, its two
indices are bytes at `0x208` and `0x209`, and each call advances the first index by four and
returns four keystream bytes packed little endian. A standard RC4, so my earlier RC4 attempt
was the right primitive with the wrong key or the wrong starting state.

`FUN_015327d0` is Blowfish-shaped but not standard Blowfish, which is the answer to why a
correct Blowfish implementation produced noise. Its F is the published one, with the four
S-boxes at offsets `0x58`, `0x458`, `0x858` and `0xc58`, one kilobyte apart. But its round
layout differs: it uses eighteen P words held at `0x10` through `0x54` in *descending* order,
and each step folds the P word into the same expression as F, as
`half ^= F(other) ^ P[k]`, instead of the standard separate `half ^= P[i]` at the head of a
round. It closes with an XOR swap of the two halves. Seventeen F calls, eighteen P words.

## The whole per-block recipe

`FUN_01533880` is now read in full, so the construction is known end to end. Its state is six
words, at `0x1060`, `0x1064`, `0x1071` and `0x1075`, plus a pointer to the RC4 object at
`0x1058` and a flag byte at `0x1070`. Per eight-byte block it does this:

1. keeps the two input words as they were,
2. XORs each of them with four RC4 keystream bytes,
3. applies the Blowfish-variant step above to the pair,
4. XORs each result with the corresponding word of the PREVIOUS input block, which is
   plaintext chaining rather than ciphertext chaining,
5. folds both results into a running XOR in the `0x1060` and `0x1064` words, and writes the
   output over the input.

The two previous-input words are the state at `0x1071` and `0x1075`, so whatever seeds those
is the initialisation vector, and the header is the likely source.

## What is left

Almost nothing, structurally. `FUN_015343d0` is the RC4 generator and `FUN_015344c0` is an
identity fill of a 256 byte array at offset `0x108`, with the two index bytes zeroed. That
offset is worth a second look, because the generator indexes its S-box from offset 8 instead,
so the object appears to carry two 256 byte arrays and only one of them is the generator's.

So the remainder is the two key schedules: mixing the key into the RC4 state, and deriving the
P and S words for the Blowfish step, together with wherever the initial chaining words come
from. All three are named shapes with addresses, not a search.

## What that means

Reading `.nx1` directly means porting the NexusDB block cipher and its dictionary layout out
of a 169 MB binary. Verifying such a port is the easier half: a correct cipher should turn
those high-entropy blocks into a recognisable block structure, mostly zeros for an empty
table, and the dictionary should give back the same field names this reconnaissance already
found in clear. What is hard is locating and porting the cipher, and that is a subproject of
its own rather than a step on the path to verifying arithmetic.

What is readable without it: the container itself, which is already ported, and
`areasettingsINI.txt`, which sits beside the tables in the same zip. That file is a plain
INI of session and UI settings, colours and tab positions and the like, plus a few last-used
IDs. It carries no model arithmetic, so it is a small convenience rather than a route to
the numbers.
