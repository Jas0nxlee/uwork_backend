"""Judge the request's cwd without confusing unused prewarmed CLI processes with execution."""


def validate_explicit_workspace(requested, model_directories, process_directories):
    assert isinstance(requested, str) and requested.startswith('/'), 'Owned absolute workspace required'
    assert model_directories == [requested], 'Explicit startup workspace was replaced in the actual model context'
    assert requested in process_directories, 'No live packaged CLI is bound to the explicit workspace'
    return {'requested': requested, 'modelWorkingDirectories': model_directories,
            'matchingCliCount': process_directories.count(requested),
            'otherPrewarmedCliCount': sum(path != requested for path in process_directories)}
