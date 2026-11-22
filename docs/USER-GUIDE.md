# Pince user guide

How to use Pince once it is running. Button names are given in English and Romanian; the language switch is at the top of every screen.

## Accounts

There are two accounts, a parent (**parinte**) and a child (**copil**). Both can add and edit books, choose covers, write notes, and mark books as read or favourite. Only the parent can delete books, manage the accounts, switch photo recognition on or off, and back up or restore the library.

## Adding books

Choose **Add a book / Adaugă o carte**, then one of four methods.

| Method | Use it for | What you get |
| --- | --- | --- |
| **Type the title** | One book you can describe yourself | One row to fill in; you can attach a cover photo |
| **Photograph a cover** | One book in your hand | Title, author, publisher and date read from the cover; the photo becomes its cover |
| **Photograph a shelf** | Many books standing on a shelf | Up to 20 rows, one per spine, each with its title cut out of the photo |
| **Photograph several covers** | Thin books with no readable spine | Up to 20 rows, one per book, each with its own cover cut out of the photo |

The three photo methods need photo recognition, which the parent switches on in **Family settings**. Typing and uploading covers always work.

### Checking what was read

Text read from a photo is never saved as it is. For each row the app looks the title and author up in Google Books and Open Library, then asks you to do one of two things:

- choose a suggested entry, which fills in the title, author, publisher and date; or
- confirm the details as you typed or corrected them.

A date can be a year (2019), a month (2019-05) or a full date (2019-05-20). Rows the app is unsure about are marked, and a book that is already in the library is flagged so you can skip it, even when its title is a typo away. When every selected row is confirmed, save.

### Photographing a shelf

- Crop or rotate the photo before asking for recognition.
- Each row shows the book's title cut from the photo, turned to read left to right, so you can compare it with what was read.
- The photo is kept in the library for signed-in family members. A book saved from it shows **Shelf photo / Fotografia raftului** on its page, which opens the photo with that book's title outlined.
- The parent can open or permanently delete each shelf photo in **Family settings**. Deleting one removes the links from its books. A backup includes the kept shelf photos.

### Photographing several covers

- Lay the books face up on a plain surface, without overlapping, and photograph them from above. Leave a little of the surface showing between the books if you can.
- Each row shows that book's cover as it will be saved. If the cut-out is off, choose **Adjust cover / Ajustează coperta** and drag a rectangle on the photo. If no cover was found, choose **Mark the cover on the photo / Marchează coperta în fotografie**. **No cover / Fără copertă** saves the book without one.
- Covers that touch each other are marked for checking, because the line between them is harder to see.
- A volume with two stories printed on one cover is saved as one book, with the two titles joined by " / ".
- This photo is not kept.

## Covers

- A book you photographed or gave a picture to keeps that cover.
- After a book is saved without a cover, the library looks for up to two cover suggestions in the background, and the book takes the first one found.
- A book saved with its own picture is not searched for other covers until you ask. After saving from a cover photo or a photo of several covers, the confirmation screen offers **Find covers online / Caută coperte pe web**; later, the same button is under **Edit book details / Modifică datele cărții**.
- To change a cover, open the book, choose **Edit book details / Modifică datele cărții**, pick one of the pictures or upload your own, and save. **Find covers online / Caută coperte pe web** searches, or searches again.
- A cover found on a bookshop or publisher page shows which site it came from.

## The bookshelf

- **Search** by title or author, and **sort** by title, author, date added or latest finished.
- **Filter** with the chips: favourites, read or not read, with or without a cover. **Lent out / Împrumutate** appears while at least one book is away. The shelf list appears once a book has been saved from a shelf photo, and shows each shelf by number, date and number of books.
- **Possible duplicates / Posibile duplicate** appears while at least two books look like the same one: the same ISBN, titles a typo apart, or a title with and without its series name. The look-alikes are listed side by side. Some may be different books, such as two volumes of a series; correct a title or delete the extra copy and the pair leaves the list.
- The bookshelf shows 24 books a page, and counts the books finished this year.
- The parent can choose **Select books / Selectează cărți**, tick books on any page or use **Select all** for every book matching the current search and filters, then delete them. Among possible duplicates there is no Select all, so that the copy to keep is never ticked by accident. Deleting is permanent, so download a backup first if you may want the books back.

## A book's page

Open a book to mark it read, make it a favourite, or write a private note. **Share book / Distribuie cartea** copies its public address. Someone who opens that address without signing in sees the title, author and chosen cover, and nothing else.

- **Reading log.** A book marked as read keeps the day it was finished, filled in with today, and a rating from one to five stars. Change the day under **Finished on / Terminată pe**, or empty it if you do not know it. Choosing the current rating again removes it.
- **Lending.** **Lend this book / Împrumută cartea** notes who has the book and since when. **It is back home / S-a întors acasă** clears it. Only the family sees who has a book.

## The wishlist

**Wishlist / Lista de dorințe** on the bookshelf holds books you want but do not have. Add to it the same ways you add a book. When a wished-for book arrives, open it and choose **We have it now / O avem acum**; it moves to the shelf as its newest book.

The parent can create one public link to the wishlist in **Family settings**, for people looking for a present. Whoever has the link sees the title, author and cover of each wished-for book, without signing in. The parent can replace the link or switch it off at any time, and the old one stops working at once. Each book on the list also has its own public page, like every book; someone who opened it while the list was shared can still open that page afterwards.

## Family settings (parent)

- Change either account's password, or switch the other account off. A new password, for either account, asks for your own current password. Changing a password signs that account out everywhere.
- Switch photo recognition on or off, and compare the estimated cost with your Azure bill.
- Open or delete kept shelf photos.
- Create, replace or switch off the public link to the wishlist.
- On a library that runs on your own computer, add, replace or remove the keys of the outside services under **Services**. A key is checked before it is saved and is not shown again afterwards. A deployed library has no such section; its keys are stored when it is deployed.
- Download a backup of the catalogue with its covers, notes and shelf photos, or restore one. Books and photos the library already holds are left as they are. A restored book keeps its place in its shelf photo and its identifier, so its public address is the same path on whichever library receives it.

A library on your computer and one on Azure have separate data and passwords. To move books between them, download a backup from one and restore it in the other.
