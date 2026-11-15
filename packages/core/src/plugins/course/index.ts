import { registerLocaleStrings } from '../../i18n';
import { strings } from './strings';
import { Course, mergeRanges, type CoursePlayerContext } from './Course';
import type { CourseOptions } from '../../types';

registerLocaleStrings(strings);

export function installCourse(ctx: CoursePlayerContext, options: CourseOptions): Course {
    return new Course(ctx, options);
}

export { Course, mergeRanges };
export type { CoursePlayerContext };
