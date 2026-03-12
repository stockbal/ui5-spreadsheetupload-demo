using { my.bookshop as db } from '../db/schema';

service AuthorsService {
    @odata.draft.enabled
    entity Authors as projection on db.Authors;
}