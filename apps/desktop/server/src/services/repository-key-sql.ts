export function repositorySql(alias: string): string {
	// Keep the host and owner in the key, so identically named repositories do
	// not collide. URL remotes drop `user@` and `:port`; scp-style remotes turn
	// `user@host:path` into `host/path`. Local projects retain their path.
	const urlRemote = "'^[A-Za-z][A-Za-z0-9+.-]*://([^/]*@)?([^/:]*)(:[0-9]*)?'";
	return `if(${alias}.git_remote != '',
  replaceRegexpOne(if(match(${alias}.git_remote, ${urlRemote}),
    replaceRegexpOne(${alias}.git_remote, ${urlRemote}, '\\2'),
    replaceRegexpOne(replaceRegexpOne(${alias}.git_remote, '^[^/@]+@', ''), ':', '/')), '[.]git/?$', ''),
  if(${alias}.project_path != '', ${alias}.project_path, ${alias}.package_name))`;
}
