
extern crate alloc;

use alloc::string::String;

/// Converts an error code into an owned String.
pub fn err(code: &str) -> String {
    String::from(code)
}

