# Notice

The files in this directory are adapted from pierre
(https://github.com/pierrecomputer/pierre), at commit
cbc028ca863d6e662706dba87b50df3eeaebbfa7: the diff view from
`packages/diffs` and the file tree from `packages/trees`.

Copyright 2025 Pierre Computer Company

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
these files except in compliance with the License. You may obtain a copy of the
License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.

Changes from the original: rewritten as dependency-free React components and
plain CSS scoped under `.pierre-diff` and `.pierre-tree`; the line diff is a
new Myers implementation in place of the `diff` package; highlighting goes
through the app's existing shiki worker.
