pub mod detect;
pub mod events;
pub mod hooks;
pub mod ipc;
pub mod observe;
pub mod repo;

// Re-export commonly used types at this module level
pub use self::observe::{Snapshot, scan_repo, poll_repo, entry_kind_for_repo_path, entry_kind_for_path};
pub use self::repo::{RepoContext, resolve, resolve_runtime, runtime_event_path, runtime_socket_path, runtime_info_path, runtime_tcp_addr};
pub use self::ipc::{RuntimeFeed, RuntimeSocket, RuntimeTcp};
pub use self::detect::{scan_agents, calculate_stats};
pub use self::hooks::{parse_stdin_payload, handle_hook, handle_git_event};
