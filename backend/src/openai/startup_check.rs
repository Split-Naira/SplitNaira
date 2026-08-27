use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct OpenApiCheck {
    pub generator: PathBuf,
    pub output: PathBuf,
}

#[derive(Debug)]
pub enum OpenApiCheckError {
    GeneratorMissing(PathBuf),
    OutputParentMissing(PathBuf),
}

impl std::fmt::Display for OpenApiCheckError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::GeneratorMissing(path) => {
                write!(
                    f,
                    "OpenAPI generator not found at '{}'. \
                     Check that the generator dependency is installed.",
                    path.display()
                )
            }
            Self::OutputParentMissing(path) => {
                write!(
                    f,
                    "OpenAPI output directory '{}' does not exist.",
                    path.display()
                )
            }
        }
    }
}

impl std::error::Error for OpenApiCheckError {}

pub fn validate_prerequisites(
    generator: impl Into<PathBuf>,
    output: impl Into<PathBuf>,
) -> Result<OpenApiCheck, OpenApiCheckError> {
    let generator = generator.into();
    let output = output.into();

    if !Path::new(&generator).exists() {
        return Err(OpenApiCheckError::GeneratorMissing(generator));
    }

    if let Some(parent) = output.parent() {
        if !parent.exists() {
            return Err(OpenApiCheckError::OutputParentMissing(parent.to_path_buf()));
        }
    }

    Ok(OpenApiCheck { generator, output })
}