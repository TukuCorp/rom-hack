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

## The RC4 key schedule, and a surprise about the key

`FUN_015344f0` is the standard RC4 key schedule: it walks the S-box swapping against the key,
indexed modulo the key length. What matters is its first line. It asserts that the key length
is either 128 or 256 bytes, so **the password is not the key** and `nx1xdefault` is only
material for whatever derives one. That is why my earlier RC4 attempt, which used the password
directly, could not have worked whatever else was right.

`FUN_015346a0` builds the state: identity fill the working array, run the schedule over it, and
copy 256 bytes back into the array the generator reads. A zero key length means an identity
state, which is the no-key case.

Then there is the surprise. `FUN_015331b0` walks a buffer in 256-byte steps and, for each step,
runs the RC4 key schedule using **the buffer contents themselves** as a 128-byte key, then
XORs the buffer against the resulting keystream. So the scheme is self-keying: the data
supplies its own key material, and the password's role is somewhere else again, most likely in
seeding the Blowfish half.

## The key schedule, and where the initial state comes from

Three more reads close most of the gap, and one of them is a genuine surprise.

`FUN_01533440` is the standard Blowfish key expansion: it takes a key and its length from the
object, and XORs each of the eighteen P words with four consecutive key bytes taken cyclically.
`FUN_01533580` shuffles the P array, forty-eight bytes, and the four S-boxes, four thousand and
ninety-six, between the object and a pair of globals, which is how the default constants get
restored after a keyed table has been used.

`FUN_015335c0` derives the RC4 key. It takes the two chaining words, runs thirty-two
iterations of the inverse block step over an incrementing counter to expand them into a
256 byte key, runs the RC4 key schedule over that, zeroes the running words, and seeds two
more words from the first two RC4 outputs. So the RC4 key is not the password either: it is
derived from the two chaining words, which is why the key length assertion was for 128 or 256
bytes rather than the eleven bytes of `nx1xdefault`.

And the surprise is where those two words come from when encrypting. `FUN_01534140` reads
`QueryPerformanceCounter` into them, transforms them with the block step keyed from the
password, and only then derives everything else. So a table is seeded from the clock, which
means the keystream cannot be reproduced from the password alone.

That is not a dead end, because `FUN_015341e0` is the other direction: it takes the two words
as arguments, stores them at `0x1071` and `0x1075`, and derives the same state from them. So
the counter value must be written into the file, and it is: the file header holds eight bytes
at offset `0x08` that look scrambled and are exactly the right size. Those are almost
certainly the two stored words, and reading them is the first step of any decryption.

## The complete recipe

The Blowfish expansion is standard to the end. `FUN_01533440` XORs each of the eighteen P
words with four key bytes taken cyclically, then runs nine expansion steps to fill P and
512 to fill the four S-boxes, each step using the inverse block step and carrying its output
forward as the next input. So the variant block function exists in both directions, and the
key schedule is the published one.

The decryption driver is `FUN_01533e30`, and reading it closes the loop. Per eight byte block
it folds the ciphertext into the running words, undoes the chaining by XORing with the
previous word pair, applies the inverse block step, XORs with two RC4 words, writes the
plaintext over the input, and carries the recovered plaintext forward as the next chain
value. That is the exact inverse of `FUN_01533880`, and between the two the construction is
pinned:

1. key the P and S words from the password bytes with the Blowfish schedule,
2. take the two chain words, which for decryption come from the file, and expand them into a
   256 byte RC4 key with thirty-two inverse block steps over an incrementing counter,
3. run the RC4 key schedule over that and reset the running words,
4. walk the data eight bytes at a time as above.

## The implementation was written, and it does not decode

The whole recipe was then written out and pointed at a block of the empty template, first as
four candidates and then as a sweep of seventy-two. The sweep varies the password between the
two spellings and empty, the chain words between three header offsets and two byte orders,
the block function between its two directions, and whether the RC4 schedule carries its final
index forward. The best result was 26 zero bytes out of 4096 against a baseline of 18, which
is what randomness looks like, and nothing else came close.

So the failure is structural rather than parametric: at least one of my readings of the round
layout, the key schedule, or the chain seeding is wrong in a way that no variation of those
four things can fix. That is worth stating plainly because it is the boundary of what reading
the decompiled C alone can settle. The remaining ambiguities are exactly the ones the
decompiler could not type for me, the `longlong` against `undefined8 *` views of the same
object and the eight byte disagreement between the S-box offsets, and resolving those needs
the disassembly rather than the C.

That is available, but not from here: the Ghidra project with `leap.exe` analysed exists, and
loading it needs memory this machine does not have. So the direct route to the tables is
gated on the same resource as everything else on the model, which means both routes now have
a named, evidence-backed blocker rather than a vague one.

## The disassembly, and the end of the parameter space

What the C could not settle needed a disassembler, so one was put into a scratch directory
outside the crate and the functions were disassembled straight out of the file. Two things
are worth writing down for whoever does this next: the image base is `0x400000`, so a
published address is absolute and the file offset is that address less the base less the
section offset; and getting that wrong disassembles data, which looks like nonsense rather
than like an error.

The offsets question is resolved, and not the way it looked. The generator and the key
schedule both index their S-box from offset `8`, and `FUN_015344c0` fills the array at
`0x108`. The reconciliation sits in the tail of `FUN_015346a0`: with a key it copies thirty
two quadwords from `8` to `0x108`, and without a key it copies them back the other way. So
`0x108` is a saved copy, the live array is at `8`, and the identity fill is the no-key case.
The RC4 seeding I had written was therefore right, and the discrepancy I suspected of being
the bug was not one.

The last parameters were varied as well: the byte order of the expanded key, the order of
its two words, and whether the schedule carries its index forward. That is thirty-six more
configurations, every one of them between 20 and 25 zero bytes out of 4096 against a
baseline of 18. Together with the earlier sweep that is over a hundred configurations
across every parameter the code names, and none is right.

So the error is structural rather than a value, and the surviving candidates are the round
layout, the key schedule and the chain seeding in some detail that only a line-by-line read
of the assembly will settle.

## The round functions, checked against the published vectors

One thing had never been checked, and it is the obvious thing to check: whether my reading of
the two round functions corresponds to the standard algorithm at all. A standard Blowfish was
written first and confirmed against the published test vectors, and then the vendor rounds
were run with the same key schedule and compared.

The answer is clean. With a standard key schedule, the function I had been calling the
inverse step, `FUN_01532e10`, applied to a zero block gives `4ef997456198dd78`, which is the
published ciphertext for that vector. So `FUN_01532e10` *is* Blowfish encryption, standard to
the bit, and my direction labels were simply the wrong way round. That also means the
vendor key schedule is the standard one, because it is the encryption function it uses to
expand P and S, which is what Blowfish specifies.

So the round layout and the key schedule are now verified rather than inferred, and the
chain seeding is the only part still standing unproven. Its callers read the two words from
fields of a header object, so locating them in the file meant reading the header code rather
than guessing at where eight bytes sit.

## Where the seed words are, and a checksum that could settle the key

Reading that header code settles it. `chunk-00172.c` around line 4240 seeds the cipher from
`param_4 + 0x208` and `param_4 + 0x20c`, transforms `0x208` bytes from the start of the same
buffer, and then calls a getter and compares what it returns against the two words at
`param_4 + 0x210` and `param_4 + 0x214`. So the seed is not inside the header at all: it sits
immediately after it, and the header carries a checksum of its own right after that.

For the template tables both seed words are zero, read straight from the file, which is worth
knowing because every earlier attempt had used bytes from inside the header. Testing with the
true seed, zero, keyed and unkeyed, as a continuous stream and from three different offsets,
still gives noise.

The checksum is the interesting part, because it is an oracle that does not need the
plaintext. If the key and cipher are right, the running XOR the driver accumulates while
transforming those `0x208` bytes should come out equal to the words at `0x210` and `0x214`.
A first attempt to shortcut it fails usefully: the plain XOR of the header words as they sit
in the file is `0x024a5544`, not the stored zero, so the header is not simply plaintext with a
plain XOR over it, and the checksum has to be computed through the real cipher.

That gives the next attempt a way to know whether the key material is right without needing
to recognise any plaintext, which is the first real oracle this route has had. It is also a
good place to stop and take stock, which the section after this does.

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
