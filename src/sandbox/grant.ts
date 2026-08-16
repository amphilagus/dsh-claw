/**
 * Writable-root injection into confined shell argv.
 * @module @deepseek-ai/dsh-claw/sandbox/grant
 */

function escapeSbpl(path: string): string {
  return path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)
}

/**
 * Add one extra writable root to a confined argv, before the `--` separator.
 * Dialects are detected by their profile arguments: bubblewrap (`--ro-bind`)
 * gains a writable bind pair, the Landlock launcher (`--ro`/`--rw`) gains a
 * read-write grant, and seatbelt (`-p`) gains an SBPL file-write allow under
 * the root. Unknown dialects are returned unchanged.
 * @param argv - the confined argv produced by the sandbox provider.
 * @param root - the extra writable root (already existing; canonicalized).
 * @returns the argv with the extra grant inserted before `--` when the dialect is known.
 */
export function injectWritableRoot(argv: readonly string[], root: string): string[] {
  const sep = argv.indexOf('--')
  const head = sep === -1 ? [...argv] : [...argv.slice(0, sep)]
  const tail = sep === -1 ? [] : argv.slice(sep)

  if (head.includes('--ro-bind')) {
    return [...head, '--bind', root, root, ...tail]
  }
  if (head.includes('--ro')) {
    return [...head, '--rw', root, ...tail]
  }
  const profileAt = head.indexOf('-p')
  if (profileAt !== -1 && profileAt + 1 < head.length) {
    head[profileAt + 1] = `${head[profileAt + 1]} (allow file-write* (subpath "${escapeSbpl(root)}"))`
    return [...head, ...tail]
  }
  return [...head, ...tail]
}
